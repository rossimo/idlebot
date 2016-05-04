require('dotenv').config();

var _ = require('lodash');
var co = require('co');
var moment = require('moment');
var RtmClient = require('@slack/client').RtmClient;
var MemoryDataStore = require('@slack/client').MemoryDataStore;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;

var client = new RtmClient(process.env.SLACK_API_TOKEN, {
    logLevel: 'debug',
    dataStore: new MemoryDataStore(),
    autoReconnect: true,
    autoMark: true
});

client.start();

var myself = '';
var channels = {};

client.on(CLIENT_EVENTS.RTM.AUTHENTICATED, function (data) {
    myself = data.self.id;
});

client.on(RTM_EVENTS.MESSAGE, function (message) {
    if (!_.has(channels, message.channel)) {
        channels[message.channel] = {
            active: {},
            timeout: 15 * 1000
        };
    }

    var channel = channels[message.channel];

    var active = channel.active[message.user] || {};
    active.time = new Date();
    channel.active[message.user] = active;

    var queueTimeout = function(active) {
        if (active.timeout) clearTimeout(active.timeout);
        active.timeout = setTimeout(function() {
            var user = client.dataStore.getUserById(message.user).name;
            client.sendMessage('@@' + user + ' is away', message.channel);
            delete channel.active[message.user];
        }, channel.timeout);
    };

    queueTimeout(active);

    var tokens = message.text.split(' ').map(token => token.trim());
    var isCommand = tokens.length >= 2 && (tokens[0] == '<@' + myself + '>' || tokens[0] == '<@' + myself + '>:');
    if (isCommand) {
        if (tokens.length == 2 && tokens[1] === 'status') {
            var statuses = _.keys(channel.active)
                .map(id => client.dataStore.getUserById(id)).map(function(user) {
                    var end = channel.active[user.id].time.getTime() + channel.timeout;
                    var millis = end - new Date().getTime();
                    var duration = moment.duration(millis, 'ms');
                    return '@@' + user.name + ' has ' + duration.humanize() + ' remaining';
                });

            client.sendMessage('*Active Users*\n' + _.join(statuses, '\n'), message.channel)
        } else if (tokens.length >= 3 && tokens[1] === 'set') {
            var number = Number(tokens[2].match(/\d/g).join(''));
            var unit = tokens[2].replace(/[0-9]/g, '') || tokens[3];
            var duration = moment.duration(number, unit);
            var millis = duration.asMilliseconds();

            if (millis > 0) {
                channel.timeout = duration.asMilliseconds();
                _.values(channel.active).forEach(active => queueTimeout(active));
                client.sendMessage('The timeout has been set to ' + duration.humanize() + '.', message.channel);
            }
        }
    }
});