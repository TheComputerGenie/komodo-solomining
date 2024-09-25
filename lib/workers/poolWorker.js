var Stratum = require('../stratum/index.js');
var logging = require('../modules/logging.js');

module.exports = function()
{
    var config = JSON.parse(process.env.config);
    var coin = config.coin.name;
    var forkId = process.env.forkId;
    let shareCount = {};
    var handlers = {
        share: function(){},
        diff: function(){}
    };
    
    function authorizeFN(ip, port, workerName, password, callback) {
        logging("PoolWorker", "special","Authorized " + workerName + ":" + password + "@" + ip, forkId);
        callback({
            error: null,
            authorized: true,
            disconnect: false
        });
    }

    var pool = Stratum.createPool(config, authorizeFN);
    pool.start();
    process.on('message', function(message) {
        switch(message.type){
            case 'blocknotify':
                pool.processBlockNotify(message.hash, 'blocknotify script');
                break;
        }
    });
    pool.on('share', function(isValidShare, isValidBlock, data) {
        if (isValidBlock) {
            //logging('PoolWorker', 'special', 'Block ' + data.height + ' found by ' + data.worker);
            logging('Blocks', 'special', 'Block found: ' + data.height + ' Hash: ' + data.blockHash + ' block Diff: ' + data.blockDiff + ' finder: ' + data.worker);
            var api = require('../modules/api.js');
            api('block', {
                block: data.height,
                finder: data.worker,
                date: new Date().getTime()
            });
            while(shareCount[data.worker] > 0) {
                shareCount[data.worker]=0;
            }
        } else if (data.blockHash && isValidBlock === undefined) {
            logging('PoolWorker', 'error', 'We thought a block was found but it was rejected by the daemon', forkId);
        }
        if (isValidShare) {
            shareCount[data.worker] = (shareCount[data.worker]+1) || 1;
            if (config.printHighShares) {
                var sdiff = data.shareDiff;
                var bdiff = data.blockDiffActual;
                sillyPercent = ((sdiff * 100) / bdiff); //percent is meaningless, but it makes us feel good to see on higher diff chains like KMD
                if (sillyPercent > 100) { logging('PoolWorker', 'error', `Share was found with diff higher than 100%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); } else
                if (sillyPercent > 75) { logging('PoolWorker', 'special', `Share was found with diff higher than 75%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); } else
                if (sillyPercent > 50) { logging('PoolWorker', 'special', `Share was found with diff higher than 50%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); };
            }
            if (config.printShares) {

                if (data.blockDiffActual > data.shareDiff) {
                    logging('PoolWorker', 'gray', `${data.height} Share accepted - Block diff: ${data.blockDiffActual} Share Diff: ${data.shareDiff} (${sillyPercent.toFixed(2)} %) ${data.worker} ${shareCount[data.worker]} shares`);
                } else {
                    logging('PoolWorker', 'special', 'Share accepted - Block diff: ' + data.blockDiffActual + ' Share Diff: ' + data.shareDiff);
                }
            }
        }
            }).on('difficultyUpdate', function(workerName, diff){
            if (config.printVarDiffAdjust) { logging('PoolWorker', 'special', 'Difficulty update to diff ' + diff + ' workerName=' + JSON.stringify(workerName)); };
            handlers.diff(workerName, diff);
        });

    pool.on('log', function(severity, logKey, logText) {
        logging('PoolWorker', 'debug', logKey, forkId);
    });
}
