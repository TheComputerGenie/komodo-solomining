var fs = require('fs');
var path = require('path');
var async = require('async');
var express = require('express');
var RateLimit = require('express-rate-limit');
var engine = require('express-dot-engine');

var Stratum = require('../stratum/index.js');
var daemon = require('../stratum/daemon.js');
var logging = require('../modules/logging.js');

module.exports = function()
{
    var config = JSON.parse(process.env.config);
    var websiteConfig = config.website;
    var app = express();
    var limiter = RateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // max 100 requests per windowMs
    });
    app.engine('dot', engine.__express);
    app.set('views', path.join(process.cwd() + '/website/public'));
    app.set('view engine', 'dot');
    app.set('coin', config.coin);
    app.use(express.static(process.cwd() + '/website/public'));

    app.get('/', function(req, res) {
        var blocks;
        var difficulty;
        var hashrate;
        daemon.interface(config.daemons, function(severity, message) { logging('Website', severity, message); });
        async.series([
            function(callback) {
                daemon.cmd('getinfo', [], function(result) {
                    blocks = result[0].response.blocks;
                    difficulty = result[0].response.difficulty;
                    callback(null)
                })
            },

            function(callback) {
                daemon.cmd('getnetworksolps', [], function(result) {
                    hashrate = result[0].response;
                    callback(null)
                })
            },

            function(callback) {
                res.render('index', {
                    blocks: blocks,
                    difficulty: difficulty,
                    hashrate: hashrate
                });
            }
        ])
    })
    app.get('/api', function(req, res) { res.render('api', {}); })
    app.get('/blocks.json', limiter, function(req, res) { res.sendFile(process.cwd() + '/logs/' + config.coin.symbol + '_blocks.json');  })

    var server = app.listen(websiteConfig.port, function() {
        var host = websiteConfig.host
        var port = server.address().port
        logging("Website", "debug", "Example app listening at http://" + host + ":" + port);
    })
}
