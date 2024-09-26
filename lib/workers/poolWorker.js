var Stratum = require('../stratum/index.js');
var logging = require('../modules/logging.js');

module.exports = function()
{
    var config = JSON.parse(process.env.config);
    var coin = config.coin.name;
    var forkId = process.env.forkId;
    let shareCount = {};
    var handlers = {
        share: () => {},
        diff: () => {}
    };
    var emitGrayLog    = (text, owner="PoolWorker") => { logging(owner, 'gray'  , text); };
    var emitErrorLog   = (text, owner="PoolWorker") => { logging(owner, 'error'  , text); };
    var emitSpecialLog = (text, owner="PoolWorker") => { logging(owner, 'special', text); };
    
    function authorizeFN(ip, port, workerName, password, callback) {
        emitSpecialLog(`Authorized ${workerName}:${password}@${ip}`);
        callback({
            error: null,
            authorized: true,
            disconnect: false
        });
    }

    var pool = Stratum.createPool(config, authorizeFN);
    pool.start();
    process.on('message', (message) => {
        switch(message.type){
            case 'blocknotify':
                pool.processBlockNotify(message.hash, 'blocknotify script');
                break;
        };
    });
    pool.on('share', (isValidShare, isValidBlock, data) => {
            if (isValidBlock) {
                emitSpecialLog(`Block found:${data.height} Hash:${data.blockHash} block Diff:${data.blockDiff} finder:${data.worker}`, "Blocks");
                var api = require('../modules/api.js');
                api('block', {
                    block: data.height,
                    finder: data.worker,
                    date: new Date().getTime()
                });
                while(shareCount[data.worker] > 0) { shareCount[data.worker]=0; };
            } else if (data.blockHash && isValidBlock === undefined) {
                emitErrorLog('We thought a block was found but it was rejected by the daemon');
            };
            if (isValidShare) {
                shareCount[data.worker] = (shareCount[data.worker]+1) || 1;
                if (config.printHighShares) {
                    var sdiff = data.shareDiff;
                    var bdiff = data.blockDiffActual;
                    sillyPercent = ((sdiff * 100) / bdiff); //percent is meaningless, but it makes us feel good to see on higher diff chains like KMD
                    if (sillyPercent > 100) { emitErrorLog(`Share was found with diff higher than 100%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); } else
                    if (sillyPercent > 75) { emitSpecialLog(`Share was found with diff higher than 75%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); } else
                    if (sillyPercent > 50) { emitSpecialLog(`Share was found with diff higher than 50%! ${sdiff}: (${sillyPercent.toFixed(0)}%)`); };
                };
                if (config.printShares) {
                    if (data.blockDiffActual > data.shareDiff) {
                        emitGrayLog(`${data.height} Share accepted - Block diff:${data.blockDiffActual} Share Diff:${data.shareDiff} (${sillyPercent.toFixed(2)} %) | ${data.worker} ${shareCount[data.worker]} shares`);
                    } else {
                        emitSpecialLog(`${data.height} Share accepted - Block diff:${data.blockDiffActual} Share Diff:${data.shareDiff} | ${shareCount[data.worker]} shares`);
                    }
                };
            };
        }).on('difficultyUpdate', (workerName, diff) => {
            if (config.printVarDiffAdjust) { emitSpecialLog(`Difficulty update workerName:${JSON.stringify(workerName)} to diff:${diff}`); };
            handlers.diff(workerName, diff);
        });
}
