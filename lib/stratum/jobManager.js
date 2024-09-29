var events = require('events');
var crypto = require('crypto');
var bignum = require('bignum');
var util = require('./util.js');
var blockTemplate = require('./blockTemplate.js');
var logging = require('../modules/logging.js');
//Unique extranonce per subscriber
var ExtraNonceCounter = function (configInstanceId) {
    var instanceId = configInstanceId || crypto.randomBytes(4).readUInt32LE(0);
    var counter = instanceId << 27;
    this.next = function () {
        var extraNonce = util.packUInt32BE(Math.abs(counter++));
        return extraNonce.toString('hex');
    };
    this.size = 4; //bytes
};

//Unique job per new block template
var JobCounter = function ()
{
    var counter = 0x0000cccc;
    this.next = function () {
        counter++;
        if (counter % 0xffffffffff === 0) { counter = 1; }
        return this.cur();
    };
    this.cur = function () { return counter.toString(16); };
};
/**
 * Emits:
 * - newBlock(blockTemplate) - When a new block (previously unknown to the JobManager) is added, use this event to broadcast new jobs
 * - share(shareData, blockHex) - When a worker submits a share. It will have blockHex if a block was found
 **/
var JobManager = module.exports = function JobManager(options)
{
    //private members
    var _this = this;
    var jobCounter = new JobCounter();
    var config = JSON.parse(process.env.config);
    const doLog = (severity, text, forkId="0") => { logging("JobManager", severity  , text, forkId); };
    const emitGrayLog = (text) => { doLog('gray', text); };
    const emitWarningLog = (text) => { doLog('warning', text); };
    const forkId = process.env.forkId;
    //public members
    this.extraNonceCounter = new ExtraNonceCounter(options.instanceId);
    this.currentJob;
    this.validJobs = {};
    this.updateCurrentJob = async function (rpcData) {
        var tmpBlockTemplate = new blockTemplate(
            jobCounter.next(),
            rpcData,
            _this.extraNoncePlaceholder,
            options.coin.reward,
            options.address,
            options.coin,
            options.pubkey
        );
        _this.currentJob = tmpBlockTemplate;
        _this.emit('updatedBlock', tmpBlockTemplate, true);
        _this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

    };
    //returns true if processed a new block
    this.processTemplate = async function (rpcData) {
        var tmpBlockTemplate = new blockTemplate(
            jobCounter.next(),
            rpcData,
            _this.extraNoncePlaceholder,
            options.coin.reward,
            options.address,
            options.coin,
            options.pubkey
        );
        
        var isNewDiff = typeof(_this.currentJob) === 'undefined';
        let newDiff = !this.currentJob || (rpcData.target !== _this.currentJob.rpcData.target);
        //console.log(newDiff);
        /* Block is new if A) its the first block we have seen so far or B) the blockhash is different and the
         block height is greater than the one we have */
        var isNewBlock = typeof(_this.currentJob) === 'undefined';
        let newBlock = !this.currentJob || (rpcData.height !== _this.currentJob.rpcData.height);

        if (!newBlock && newDiff) {
            if (typeof(_this.currentJob) !== 'undefined') {
                let targeta = bignum(_this.currentJob.rpcData.target, 16);
                let targetb = bignum(rpcData.target, 16);
                let diffa = parseFloat((algos.komodo.diff1 / targeta.toNumber()).toFixed(9));
                let diffb = parseFloat((algos.komodo.diff1 / targetb.toNumber()).toFixed(9));
                if ((process.env.forkId && process.env.forkId == '0') || (!process.env.forkId)) {
                    if (config.printNewWork === true) {
                        emitGrayLog(`The diff for block ${rpcData.height} has changed from: ${diffa} to ${diffb}`);
                    }
                }
            }
            this.updateCurrentJob(rpcData);
            return false;
        }
        if (!newBlock && _this.currentJob.rpcData.previousblockhash !== rpcData.previousblockhash) {
            newBlock = true;
            //If new block is outdated/out-of-sync than return
            if (rpcData.height < _this.currentJob.rpcData.height) { return false; }
        }
        if (!newBlock) {
            this.updateCurrentJob(rpcData);
            return false;
        }
        this.currentJob = tmpBlockTemplate;
        this.validJobs = {};
        _this.emit('newBlock', tmpBlockTemplate);
        this.validJobs[tmpBlockTemplate.jobId] = tmpBlockTemplate;

        this.target = bignum(rpcData.target, 16);
        this.difficulty = parseFloat((algos.komodo.diff1 / this.target.toNumber()).toFixed(9));
        const nethash = (givenDiff) => (((((givenDiff * Math.pow(2, 32)) / 60) / Math.pow(10, 9))).toFixed(2));
        const diffCalc = (hashrate) => util.getReadableHashRateString(hashrate);
        const vnethash = (givenDiff) => (nethash(givenDiff)*8.192).toFixed(2);
        if (!process.env.forkId || process.env.forkId === '0') {
            if (config.printCurrentDiff === true) {
                emitGrayLog(`The diff for block ${rpcData.height}: ${this.difficulty}`);
            };
	        if (config.printNethash === true && newBlock){
                emitWarningLog(`Base nethash for ${rpcData.height} is: ${diffCalc(vnethash(this.difficulty))}`);
                emitWarningLog(`Effective nethash for ${rpcData.height} is: ${diffCalc(nethash(this.difficulty))}`);
            };
        };
        return true;
    };
    this.processShare = function (jobId, previousDifficulty, difficulty, extraNonce1, extraNonce2, nTime, nonce, ipAddress, port, workerName, soln) {
        var shareError = function (error) {
            _this.emit('share', {
                job: jobId,
                ip: ipAddress,
                worker: workerName,
                difficulty: difficulty,
                error: error[1]
            });
            return {error: error, result: null};
        };
        var submitTime = Date.now() / 1000 | 0;
        var job = this.validJobs[jobId];
        if (typeof job === 'undefined' || job.jobId != jobId) {
            return shareError([21, 'job not found']);
        }
        if (nTime.length !== 8) {
            return shareError([20, 'incorrect size of ntime']);
        }
        var nTimeInt = parseInt(util.reverseBuffer(new Buffer.from(nTime, 'hex')).toString('hex'), 16);
	    if (Number.isNaN(nTimeInt)) {
	        // console.log('Invalid nTime: ', nTimeInt, nTime)
	        return shareError([20, 'invalid ntime'])
	    }
        if (nTimeInt < job.rpcData.curtime || nTimeInt > submitTime + 7200) {
            return shareError([20, 'ntime out of range']);
        }
        if (nonce.length !== 64) {
            return shareError([20, 'incorrect size of nonce']);
        }
        if (soln.length !== 2694) {
            return shareError([20, 'incorrect size of solution']);
        }
        if (!job.registerSubmit(extraNonce1.toLowerCase(), extraNonce2.toLowerCase(), nTime, nonce)) {
            return shareError([22, 'duplicate share']);
        }
        var extraNonce1Buffer = new Buffer.from(extraNonce1, 'hex');
        var extraNonce2Buffer = new Buffer.from(extraNonce2, 'hex');

        var headerBuffer = job.serializeHeader(nTime, nonce); // 144 bytes (doesn't contain soln)
        var headerSolnBuffer = new Buffer.concat([headerBuffer, new Buffer.from(soln, 'hex')]);
        var headerHash = util.sha256d(headerSolnBuffer);
        var headerBigNum = bignum.fromBuffer(headerHash, {endian: 'little', size: 32});

        var blockHashInvalid;
        var blockHash;
        var blockHex;

        var shareDiff = (algos.komodo.diff1 / headerBigNum.toNumber());
        var blockDiffAdjusted = job.difficulty;
        //check if block candidate
        if (headerBigNum.le(job.target)) {
            blockHex = job.serializeBlock(headerBuffer, new Buffer.from(soln, 'hex')).toString('hex');
            blockHash = util.reverseBuffer(headerHash).toString('hex');
        } else {
            if (options.emitInvalidBlockHashes) {
                blockHashInvalid = util.reverseBuffer(util.sha256d(headerSolnBuffer)).toString('hex');
            }
            //Check if share didn't reached the miner's difficulty)
            if (shareDiff / difficulty < 0.99) {

                //Check if share matched a previous difficulty from before a vardiff retarget
                if (previousDifficulty && shareDiff >= previousDifficulty) {
                    difficulty = previousDifficulty;
                } else {
                    return shareError([23, 'low difficulty share of ' + shareDiff]);
                }
            }
        }
        /*
        console.log('job: ' + jobId);
        console.log('ip: ' + ipAddress);
        console.log('port: ' + port);
        console.log('worker: ' + workerName);
        console.log('height: ' + job.rpcData.height);
        console.log('blockReward: ' + job.rpcData.reward);
        console.log('difficulty: ' + difficulty);
        console.log('shareDiff: ' + shareDiff.toFixed(8));
        console.log('blockDiff: ' + blockDiffAdjusted);
        console.log('blockDiffActual: ' + job.difficulty);
        console.log('blockHash: ' + blockHash);
        console.log('blockHashInvalid: ' + blockHashInvalid);
        */
        _this.emit('share', {
            job: jobId,
            ip: ipAddress,
            port: port,
            worker: workerName,
            height: job.rpcData.height,
            blockReward: job.rpcData.miner,
            difficulty: difficulty,
            shareDiff: shareDiff.toFixed(8),
            blockDiff: blockDiffAdjusted,
            blockDiffActual: job.difficulty,
            blockHash: blockHash,
            blockHashInvalid: blockHashInvalid
        }, blockHex);
        return {result: true, error: null, blockHash: blockHash};
    };
};

JobManager.prototype.__proto__ = events.EventEmitter.prototype;
