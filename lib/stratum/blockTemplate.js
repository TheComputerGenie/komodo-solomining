var bignum = require('bignum');
var util = require('./util.js');
var merkle = require('./merkleTree.js');
var transactions = require('./transactions.js');
var logging = require('../modules/logging.js');
/**
 * The BlockTemplate class holds a single job.
 * and provides several methods to validate and submit it to the daemon coin
**/
var BlockTemplate = module.exports = function BlockTemplate(jobId, rpcData, extraNoncePlaceholder, reward, poolAddress, coin, pubkey) {

    const doLog = (severity, text, forkId="0") => { logging("Blocks", severity  , text, forkId); };
    const emitGrayLog = (text) => { doLog('gray', text); };
    const emitWarningLog = (text) => { doLog('warning', text); };


    const pack32 = (str) => util.packUInt32LE(str).toString('hex');
    const forkId = process.env.forkId;
    var config = JSON.parse(process.env.config);
    var coin = config.coin.name;
    //private members
    var submits = [];
    
    //public members
    this.rpcData = rpcData;
    this.jobId = jobId;

    // get target info
    this.target = bignum(rpcData.target, 16);
    this.difficulty = parseFloat((algos.komodo.diff1 / this.target.toNumber()).toFixed(9));

    // generate the fees and coinbase tx
    var blockReward = (this.rpcData.miner) * 100000000;
    this.txCount = this.rpcData.transactions.length + 1; // add total txs and new coinbase
    var fees = [];
    rpcData.transactions.forEach((value) => {
        fees.push(value);
    });

    this.rewardFees = transactions.getFees(fees);
    rpcData.rewardFees = this.rewardFees;

    if (typeof this.genTx === 'undefined') {
        this.genTx = transactions.createGeneration(rpcData.height, blockReward, poolAddress, coin, pubkey, this.rpcData.vouts).toString('hex');
        this.genTxHash = transactions.txHash();
    }
    // generate the merkle root
    this.prevHashReversed = util.reverseHex(rpcData.previousblockhash);
    this.hashReserved = util.reverseHex(rpcData.finalsaplingroothash);
    this.merkleRoot = merkle.getRoot(rpcData, this.genTxHash);
    this.merkleRootReversed = util.reverseHex(this.merkleRoot);
    // we can't do anything else until we have a submission

    //block header per https://github.com/zcash/zips/blob/master/protocol/protocol.pdf
    this.serializeHeader = (nTime, nonce) => {
        let header =  new Buffer.alloc(140);
        let position = 0;

        header.writeUInt32LE(this.rpcData.version, position += 0, 4, 'hex');
        header.write(this.prevHashReversed, position += 4, 32, 'hex');
        header.write(this.merkleRootReversed, position += 32, 32, 'hex');
        header.write(this.hashReserved, position += 32, 32, 'hex');
        header.write(nTime, position += 32, 4, 'hex');
        header.write(util.reverseHex(rpcData.bits), position += 4, 4, 'hex');
        header.write(nonce, position += 4, 32, 'hex');
        return header;
    };

    // join the header and txs together
    this.serializeBlock = (header, soln) => {
        let varInt;
        let txCount = this.txCount.toString(16);
        if (Math.abs(txCount.length % 2) == 1) {
            txCount = `0${txCount}`;
        }

        if (this.txCount <= 0x7f) {
            varInt = new Buffer.from(txCount, 'hex');
        } else if (this.txCount <= 0x7fff) {
            varInt = new Buffer.concat([Buffer('FD', 'hex'), new Buffer.from(txCount, 'hex')]);
        }
        buf = new Buffer.concat([
                                    header,
                                    soln,
                                    varInt,
                                    new Buffer.from(this.genTx, 'hex')
                                ]);


        if (this.txCount > 1) {
            this.rpcData.transactions.forEach((value) => {
                tmpBuf = new Buffer.concat([buf, new Buffer.from(value.data, 'hex')]);
                buf = tmpBuf;
            });
        }
        return buf;
    };

    // submit the block header
    this.registerSubmit = (header, soln) => {
        let submission = (header + soln).toLowerCase();
        if (submits.indexOf(submission) === -1) {
            submits.push(submission);
            return true;
        }
        return false;
    };

    // used for mining.notify
    this.getJobParams = () => {
        if (!this.jobParams) {
            this.jobParams = [
                                 this.jobId,
                                 pack32(this.rpcData.version),
                                 this.prevHashReversed,
                                 this.merkleRootReversed,
                                 this.hashReserved,
                                 pack32(rpcData.curtime),
                                 util.reverseHex(this.rpcData.bits),
                                 true
                             ];
        }
        return this.jobParams;
    };
        const nethash = (givenDiff) => (((((givenDiff * Math.pow(2, 32)) / 60) / Math.pow(10, 9))).toFixed(2));
        const diffCalc = (hashrate) => util.getReadableHashRateString(hashrate);
        const vnethash = (givenDiff) => (nethash(givenDiff)*8.192).toFixed(2);
        if (!process.env.forkId || process.env.forkId === '0') {
            if (config.printCurrentDiff === true) {
                //emitGrayLog(`The diff for block ${rpcData.height}: ${this.difficulty}`);
            };};
};
