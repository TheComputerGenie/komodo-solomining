const fs = require('fs');
const os = require('os');
const cluster = require('cluster');

const Website = require('./lib/workers/website.js');
const logging = require('./lib/modules/logging.js');
const PoolWorker = require('./lib/workers/poolWorker.js');
const CliListener = require('./lib/workers/cliListener.js');

if (!process.argv[3]) {
    var config = require('./config.json');
} else {
    var config = require('./' + process.argv[3] + '_config.json');
}
var coinFilePath = 'coins/' + config.coin;

if (!fs.existsSync(coinFilePath))
{
    console.log('Master', config.coin, 'could not find file: ' + coinFilePath);
    return;
}

config.coin = JSON.parse(fs.readFileSync(coinFilePath, { encoding: 'utf8' }));

if (!config.coin.nonDexstatsExplorer) { 
    config.coin.explorer = 'https://' + config.coin.symbol + '.explorer.dexstats.info';
} else {
    config.coin.explorer = config.coin.nonDexstatsExplorer;
}

if (cluster.isWorker)
{
    switch (process.env.workerType) {
        case 'pool':
            new PoolWorker();
            break;
        case 'website':
            new Website();
            break;
    }
    return;
}


function spawnPoolWorkers()
{
    var numForks = (function() {
        if (!config.clustering || !config.clustering.enabled) { return 1; }
        if (config.clustering.forks === 'auto') { return os.cpus().length; }
        if (!config.clustering.forks || isNaN(config.clustering.forks)) { return 1; }

        return config.clustering.forks;
    })();

    var poolWorkers = {};

    function createPoolWorker(forkId) {
        var worker = cluster.fork({
            workerType: 'pool',
            forkId: forkId,
            config: JSON.stringify(config)
        });
        worker.forkId = forkId;
        worker.type = 'pool';
        poolWorkers[forkId] = worker;
        worker.on('exit', function(code, signal) {
            logging('Pool', 'error', 'Fork ' + forkId + ' died, spawning replacement worker...', forkId)
            setTimeout(function() { createPoolWorker(forkId); }, 2000);
        });
    }
    var i = 0;
    var spawnInterval = setInterval(function() {
        createPoolWorker(i);
        i++;
        if (i == numForks) {
            clearInterval(spawnInterval);
            logging('Init', 'debug', 'Spawned proxy on ' + numForks + ' threads(s)')
        }
    }, 250);
}

function startCliListener()
{
    var cliPort = config.cliPort;
    var listener = new CliListener(cliPort);
    listener.on('log', function(text) {
        console.log('CLI: ' + text);
    }).on('command', function(command, params, options, reply) {
        switch (command) {
            case 'blocknotify':
                Object.keys(cluster.workers).forEach(function(id) {
                    cluster.workers[id].send({
                        type: 'blocknotify',
                        workid: cluster.workers[id],
                        coin: params[0],
                        hash: params[1]
                    });
                });
                reply('Pool notified');
                break;

            default:
                reply('unrecognized command "' + command + '"');
                break;
        }
    }).start();
}

function startWebsite()
{
    if (!config.website.enabled) { return; }
    var worker = cluster.fork({
        workerType: 'website',
        config: JSON.stringify(config)
    });
    worker.on('exit', function(code, signal) {
        logging('Website', 'error', 'Website process died, spawning replacement...')
        setTimeout(function() {
            startWebsite(config);
        }, 2000);
    });
}

function createEmptyLogs()
{
    try {
        fs.readFileSync('./logs/blocks.json')
    } catch (err) {
        if (err.code === "ENOENT") {
            fs.writeFileSync('./logs/blocks.json', '[]');
        } else {
            throw err;
        }
    }
}

(function init()
{
    createEmptyLogs();
    spawnPoolWorkers();
    startCliListener();
    startWebsite();
})();
