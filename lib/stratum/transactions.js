var bignum = require("bignum");
var util = require("./util.js");
const init = require("../../init");
const bitcoin = require("bitgo-utxo-lib");
const logging = require("../modules/logging.js");

// public members
var txHash;

exports.txHash = function()
{
    return txHash;
};

const scriptCompile = addrHash => bitcoin.script.compile([
    bitcoin.opcodes.OP_DUP,         //76
    bitcoin.opcodes.OP_HASH160,     //A9
    addrHash,
    bitcoin.opcodes.OP_EQUALVERIFY, //88
    bitcoin.opcodes.OP_CHECKSIG     //AC
]);

const scriptCompileP2PK = pubkey => bitcoin.script.compile([
    Buffer.from(pubkey, "hex"),
    bitcoin.opcodes.OP_CHECKSIG     //AC
]);

const scriptFoundersCompile = address => bitcoin.script.compile([
    bitcoin.opcodes.OP_HASH160,     //A9
    address,
    bitcoin.opcodes.OP_EQUAL        //87
]);

exports.createGeneration = function(blockHeight, blockReward, poolAddress, coin, pubkey, vouts) { // these must match genTx in blockTemplate.js
    var poolAddrHash = bitcoin.address.fromBase58Check(poolAddress).hash;
    // We're using the tx builder, so we define the params for it:
    let network = bitcoin.networks[coin.symbol];
    let txb = new bitcoin.TransactionBuilder(network);
    txb.setVersion(bitcoin.Transaction.ZCASH_SAPLING_VERSION);

    // input for coinbase tx
    if (blockHeight.toString(16).length % 2 === 0) {
        var blockHeightSerial = blockHeight.toString(16);
    } else {
        var blockHeightSerial = '0' + blockHeight.toString(16);
    }

    var height = Math.ceil((blockHeight << 1).toString(2).length / 8);
    var lengthDiff = blockHeightSerial.length/2 - height;

    for (var i = 0; i < lengthDiff; i++) {
        blockHeightSerial = blockHeightSerial + '00';
    }

    length = '0' + height;
    var serializedBlockHeight = new Buffer.concat([
            new Buffer(length, 'hex'),
            util.reverseBuffer(new Buffer(blockHeightSerial, 'hex')),
            new Buffer('00', 'hex') // OP_0
        ]);

    tx.addInput(new Buffer('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
            4294967295,
            4294967295,
            new Buffer.concat([serializedBlockHeight, Buffer(toHexy(blockHeight.toString()), "hex")])
           );

    switch (vouts[i].scriptPubKey.type) {
        case "pubkey":
            txb.addOutput(scriptCompileP2PK(i == 0 ? pubkey : vouts[i].scriptPubKey.asm.split(" ", 1)), amt);
            break;
        case "pubkeyhash":
            txb.addOutput(scriptCompile( i == 0 ? poolAddrHash : bitcoin.address.fromBase58Check(vouts[i].scriptPubKey.addresses[0]).hash), amt);
            break;
        default:
            //logging("Blocks", "debug", JSON.stringify(vouts[i]))
            txb.addOutput(scriptCompile(i == 0 ? poolAddrHash : bitcoin.address.fromBase58Check(vouts[i].scriptPubKey.addresses[0]).hash), amt);
            break;
        }
    }
    // build
    let tx = txb.build();
    txHex = tx.toHex();
    // assign
    txHash = tx.getHash().toString('hex');
    /*
    console.log('txHex: ' + txHex.toString('hex'));
    console.log('txHash: ' + txHash);
    */
    return txHex;
};

module.exports.getFees = function(feeArray)
{
    var fee = Number();
    feeArray.forEach(function(value) {
        fee = fee + Number(value.fee);
    });

    return fee;
};
