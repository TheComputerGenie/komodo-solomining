var async = require('async');
var events = require('events');
var util = require('./util.js');
var peer = require('./peer.js');
var daemon = require('./daemon.js');
var stratum = require('./stratum.js');
var varDiff = require('./varDiff.js');
var jobManager = require('./jobManager.js');
var logging = require('../modules/logging.js');
/*process.on('uncaughtException', function(err) {
 console.log(err.stack);
 throw err;
 });*/

var pool = module.exports = function pool(options, authorizeFn)
{
    this.options = options;
    var config = JSON.parse(process.env.config);
    var _this = this;
    var blockPollingIntervalId;
    const doLog = (severity, text, forkId="0") => { logging(" Pool ", severity  , text, forkId); };
    const emitLog        = (text) => { doLog('debug'  , text); };
    const emitWarningLog = (text) => { doLog('warning', text); };
    const emitErrorLog   = (text) => { doLog('error'  , text); };
    const emitSpecialLog = (text) => { doLog('special', text); };

    this.start = () => {
        SetupVarDiff();
        SetupApi();
        SetupDaemonInterface(() => {
            DetectCoinData(() => {
                SetupJobManager();
                OnBlockchainSynced(() => {
                    GetFirstJob(() => {
                        SetupBlockPolling();
                        SetupPeer();
                        StartStratumServer(() => {
                            OutputPoolInfo();
                            _this.emit('started');
                        });
                    });
                });
            });
        });
    };


    function GetFirstJob(finishedCallback) {

        GetBlockTemplate(function(error, result) {
            if (error) {
                emitErrorLog('Error with getblocktemplate on creating first job, server cannot start');
                return;
            }
            var portWarnings = [];
            var networkDiffAdjusted = options.initStats.difficulty;

            Object.keys(options.ports).forEach(function(port) {
                var portDiff = options.ports[port].diff;
                if (networkDiffAdjusted < portDiff) { portWarnings.push('port ' + port + ' w/ diff ' + portDiff); }
            });

            //Only let the first fork show synced status or the log wil look flooded with it
            if (portWarnings.length > 0 && (!process.env.forkId || process.env.forkId === '0')) {
                var warnMessage = 'Network diff of ' + networkDiffAdjusted + ' is lower than ' + portWarnings.join(' and ');
                emitWarningLog(warnMessage);
            }
            finishedCallback();
        });
    }

    function OutputPoolInfo() {
        var startMessage = 'Stratum Pool Server Started for ' + options.coin.name + ' [' + options.coin.symbol.toUpperCase() + ']';
        if (process.env.forkId && process.env.forkId !== '0') {
            doLog('debug', startMessage, process.env.forkId);
            return;
        }
        var infoLines = [startMessage,
                         'Network Connected:\t' + (options.testnet ? 'Testnet' : 'Mainnet'),
                         'Detected Reward Type:\t' + options.coin.reward,
                         'Current Block Height:\t' + _this.jobManager.currentJob.rpcData.height,
                         'Current Block Diff:\t' + _this.jobManager.currentJob.difficulty,
                         'Current Connect Peers:\t' + options.initStats.connections,
                         'Network Difficulty:\t' + options.initStats.difficulty,
                         'Network Hash Rate:\t' + util.getReadableHashRateString(options.initStats.networkHashRate),
                         'Stratum Port(s):\t' + _this.options.initStats.stratumPorts.join(', ')
                        ];

        if (typeof options.blockRefreshInterval === "number" && options.blockRefreshInterval > 0) { infoLines.push('Block polling every:\t' + options.blockRefreshInterval + ' seconds'); }
        emitSpecialLog(infoLines.join('\n\t\t\t\t\t\t'));
    }

    function OnBlockchainSynced(syncedCallback) {
        var checkSynced = function(displayNotSynced) {
            _this.daemon.cmd('getblocktemplate', [], function(results) {
                var synced = results.every(function(r) { return !r.error || r.error.code !== -10; });
                if (synced) {
                    syncedCallback();
                } else {
                    if (displayNotSynced) { displayNotSynced(); }
                    setTimeout(checkSynced, 5000);
                    //Only let the first fork show synced status or the log wil look flooded with it
                    if (!process.env.forkId || process.env.forkId === '0') { generateProgress(); }
                }
            });
        };
        checkSynced(() => {
            //Only let the first fork show synced status or the log wil look flooded with it
            if (!process.env.forkId || process.env.forkId === '0') {
                emitErrorLog('Daemon is still syncing with network (download blockchain) - server will be started once synced');
            }
        });

        var generateProgress = () => {
            _this.daemon.cmd('getinfo', [], function(results) {
                var blockCount = results.sort(function(a, b) { return b.response.blocks - a.response.blocks; })[0].response.blocks;

                //get list of peers and their highest block height to compare to ours
                _this.daemon.cmd('getpeerinfo', [], function(results) {
                    var peers = results[0].response;
                    var totalBlocks = peers.sort(function(a, b) {
                        return b.startingheight - a.startingheight;
                    })[0].startingheight;

                    var percent = (blockCount / totalBlocks * 100).toFixed(2);
                    emitWarningLog('Downloaded ' + percent + '% of blockchain from ' + peers.length + ' peers');
                });
            });
        };
    }

    function SetupApi() {
        if (typeof(options.api) !== 'object' || typeof(options.api.start) !== 'function') {
        } else {
            options.api.start(_this);
        }
    }

    function SetupPeer() {
        if (!options.p2p || !options.p2p.enabled) { return; }

        if (options.testnet && !options.coin.peerMagicTestnet) {
            emitErrorLog('p2p cannot be enabled in testnet without peerMagicTestnet set in coin configuration');
            return;
        } else if (!options.coin.peerMagic) {
            emitErrorLog('p2p cannot be enabled without peerMagic set in coin configuration');
            return;
        }
        _this.peer = new peer(options);
        _this.peer.on('connected', () => {
            doLog('debug', 'p2p connection successful\t\t', process.env.forkId);
        }).on('connectionRejected', () => {
            emitErrorLog('p2p connection failed - likely incorrect p2p magic value');
        }).on('disconnected', () => {
            emitWarningLog('p2p peer node disconnected - attempting reconnection...');
        }).on('connectionFailed', function(e) {
            emitErrorLog('p2p connection failed - likely incorrect host or port');
        }).on('socketError', function(e) {
            emitErrorLog('p2p had a socket error ' + JSON.stringify(e));
        }).on('error', function(msg) {
            emitWarningLog('p2p had an error ' + msg);
        }).on('blockFound', function(hash) {
            _this.processBlockNotify(hash, 'p2p');
        });
    }

    function SetupVarDiff() {
        Object.keys(options.ports).forEach(function (port) {
            if (options.ports[port].varDiff)
                _this.setVarDiff(port, options.ports[port].varDiff);
        });
    }

    /*
     Daemon uses submitblock for submitting new blocks
     */
    function SubmitBlock(blockHex, callback) {
        _this.daemon.cmd('submitblock',
                        [blockHex],
                        function(results) {
                            for (var i = 0; i < results.length; i++) {
                                var result = results[i];
                                var nodeID = result.instance.index;
                                if (result.error) {
                                    emitErrorLog('rpc error with daemon instance ' + nodeID + ' when submitting block: ' + JSON.stringify(result.error));
                                    return;
                                } else if (result.response !== null) {
                                    var msgReason;
                                    switch(result.response) {
                                                case 'duplicate':
                                                    msgReason = ' - node already has valid copy of block.';
                                                    break;
                                                case 'duplicate-invalid':
                                                    msgReason = ' - node already has block, but it is invalid.';
                                                    break;
                                                case 'duplicate-inconclusive':
                                                    msgReason = ' - node already has block but has not validated it (check time & daemon logs).';
                                                    break;
                                                case 'inconclusive':
                                                    msgReason = ' - node has not validated the block, it may not be on the node\'s current best chain (likely lost a race).';
                                                    break;
                                                case 'rejected':
                                                    msgReason = ' - block was rejected as invalid.';
                                                    break;
                                                default:
                                                    msgReason = ' Daemon has responded with something it shouldn\'t: ' + result.response;
                                                    break;
                                    }
                                    emitErrorLog('rpc error with daemon instance ' + nodeID + ' when submitting block ' + msgReason );
                                    return;
                                }
                            }
                            emitWarningLog('Successfully submitted block to daemon instance(s).');
                            callback();
                        }
        );
    }

    function SetupJobManager() {
        _this.jobManager = new jobManager(options);
        _this.jobManager.on('newBlock', function(blockTemplate) {
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                _this.stratumServer.broadcastMiningJobs(blockTemplate.getJobParams());
            }
        }).on('updatedBlock', function(blockTemplate) {
            //Check if stratumServer has been initialized yet
            if (_this.stratumServer) {
                var job = blockTemplate.getJobParams();
                job[7] = false;
                _this.stratumServer.broadcastMiningJobs(job);
            }
        }).on('share', function(shareData, blockHex) {
            var isValidShare = !shareData.error;
            var isValidBlock = !!blockHex;
            var emitShare = () => {
                _this.emit('share', isValidShare, isValidBlock, shareData);
            };
            /*
             If we calculated that the block solution was found,
             before we emit the share, lets submit the block,
             then check if it was accepted using RPC getblock
             */
            if (!isValidBlock) {
                emitShare();
            } else {
                SubmitBlock(blockHex, () => {
                    CheckBlockAccepted(shareData.blockHash, function(isAccepted, tx) {
                        isValidBlock = isAccepted;
                        shareData.txHash = tx;
                        emitShare();
                        GetBlockTemplate(function(error, result, foundNewBlock) {
                            if (foundNewBlock) { emitLog('Block notification via RPC after block submission'); }
                        });
                    });
                });
            }
        });
    }

    function SetupDaemonInterface(finishedCallback) {
        if (!Array.isArray(options.daemons) || options.daemons.length < 1) {
            emitErrorLog('No daemons have been configured - pool cannot start');
            return;
        }
        _this.daemon = new daemon.interface(options.daemons, function(severity, message) { _this.emit('log', severity, message); });
        _this.daemon.once('online', () => {
            finishedCallback();
        }).on('connectionFailed', function(error) {
            emitErrorLog('Failed to connect daemon(s): ' + JSON.stringify(error));
        }).on('error', function(message) {
            emitErrorLog(message);
        });
        _this.daemon.init();
    }

    function DetectCoinData(finishedCallback) {
        var batchRpcCalls = [
                                ['validateaddress', [options.address]],
                                ['getdifficulty', []],
                                ['getinfo', []],
                                ['getmininginfo', []]
                            ];
        _this.daemon.batchCmd(batchRpcCalls, function(error, results) {
            if (error || !results) {
                emitErrorLog('Could not start pool, error with init batch RPC call: ' + JSON.stringify(error));
                return;
            }
            var rpcResults = {};
            for (var i = 0; i < results.length; i++) {
                var rpcCall = batchRpcCalls[i][0];
                var r = results[i];
                rpcResults[rpcCall] = r.result || r.error;
                if (r.error || !r.result) {
                    emitErrorLog('Could not start pool, error with init RPC ' + rpcCall + ' - ' + JSON.stringify(r.error));
                    return;
                }
            }
            if (!rpcResults.validateaddress.isvalid) {
                emitErrorLog('Daemon reports address is not valid');
                return;
            }
            if (rpcResults.getinfo.staked) {
                options.coin.reward = 'POS';
            } else {
                options.coin.reward = 'POW';
            }
            doLog('warning', `This coin is ${options.coin.reward}\t\t\t`, process.env.forkId);
            /* POS coins must use the pubkey in coinbase transaction, and pubkey is
             only given if address is owned by wallet.
            if (options.coin.reward === 'POS' && typeof(rpcResults.validateaddress.pubkey) === 'undefined') {
                emitErrorLog('The address provided is not from the daemon wallet - this is required for POS coins.');
                return;
            }*/
            options.poolAddressScript = (() => { return util.addressToScript(rpcResults.validateaddress.address); })();
            options.testnet = rpcResults.getinfo.testnet;
            options.protocolVersion = rpcResults.getinfo.protocolversion;

            options.initStats = {
                connections: rpcResults.getinfo.connections,
                difficulty: rpcResults.getinfo.difficulty,
                networkHashRate: rpcResults.getmininginfo.networkhashps
            };
            finishedCallback();
        });
    }

    const StartStratumServer = (finishedCallback) => {
        _this.stratumServer = new stratum.Server(options, authorizeFn);

        _this.stratumServer.on('started', () => {
            options.initStats.stratumPorts = Object.keys(options.ports);
            _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());
            finishedCallback();

        }).on('broadcastTimeout', () => {
            if ((process.env.forkId && process.env.forkId == '0') || (!process.env.forkId)) {
                if (config.printNewWork === true) {
                    emitLog('No new blocks for ' + options.jobRebroadcastTimeout + ' seconds - updating transactions & rebroadcasting work');
                }
            }
            GetBlockTemplate((error, rpcData, processedBlock) => {
                if (error || processedBlock) { return; }
                _this.jobManager.updateCurrentJob(rpcData);
            });
        }).on('client.connected', (client) => {
            if (typeof(_this.varDiff) !== 'undefined') {
                if (typeof(_this.varDiff[client.socket.localPort]) !== 'undefined') {
                    _this.varDiff[client.socket.localPort].manageClient(client);
                }
            }
            client.on('difficultyChanged', (diff) => {
                _this.emit('difficultyUpdate', client.workerName, diff);
            }).on('subscription', function (params, resultCallback) {
                var extraNonce = _this.jobManager.extraNonceCounter.next();
                resultCallback(null,
                               extraNonce,
                               extraNonce
                              );
                /* This is the part where we set mindiff for miners to return
                difficulty = difficulty_1_target / current_target
                They send no shares with a diff lower than set here
                We decide if:
                a) we want to use a literal port value we give it in config (true)
                or
                b) we only want it to submit when a valid blockdiff solution is found (false)
                */
                const sendDiff = (sDdiff) => { this.sendDifficulty(sDdiff); };
                let cJobDiff = _this.jobManager.currentJob.difficulty;
                
                if (typeof(options.ports[client.socket.localPort]) !== 'undefined') {
                    if (typeof(options.minDiffAdjust) !== 'undefined' && options.minDiffAdjust.toString() == 'true') {
                        sendDiff(options.ports[client.socket.localPort].diff);
                    } else {
                        sendDiff(cJobDiff);
                    };
                } else {
                    sendDiff(cJobDiff);
                };
                this.sendMiningJob(_this.jobManager.currentJob.getJobParams());
            }).on('submit', (params, resultCallback) => {
                var result = _this.jobManager.processShare(
                                 params.jobId,
                                 client.previousDifficulty,
                                 client.difficulty,
                                 client.extraNonce1,
                                 params.extraNonce2,
                                 params.nTime,
                                 params.nonce,
                                 client.remoteAddress,
                                 client.socket.localPort,
                                 params.name,
                                 params.soln
                             );
                resultCallback(result.error, result.result ? true : null);
            }).on('malformedMessage', (message) => {
                emitWarningLog(`Malformed message from ${client.getLabel()}: ${message}`);
            }).on('socketError', (err) => {
                emitWarningLog(`Socket error from ${client.getLabel()}: ${JSON.stringify(err)}`);
            }).on('socketTimeout', (reason) => {
                emitWarningLog(`Connected timed out for ${client.getLabel()}: ${reason}`)
            }).on('socketDisconnect', () => {
                emitWarningLog(`Socket disconnected from ${client.getLabel()}`);
            }).on('unknownStratumMethod', (fullMessage) => {
                emitLog(`Unknown stratum method from ${client.getLabel()}: ${fullMessage.method}`);
            }).on('socketFlooded', () => {
                emitWarningLog(`Detected socket flooding from ${client.getLabel()}`);
            });
        });
    }

    const SetupBlockPolling = () => {
        if (typeof options.blockRefreshInterval !== "number" || options.blockRefreshInterval <= 0) {
            doLog('debug', 'Block template polling has been disabled', process.env.forkId);
            return;
        }
        var pollingInterval = options.blockRefreshInterval;
        blockPollingIntervalId = setInterval(() => {
            GetBlockTemplate((error, result, foundNewBlock) => {
                if (foundNewBlock) {
                    if (!process.env.forkId || process.env.forkId === '0') {
                        emitLog(`Notification via RPC polling: ${options.coin.name} blockchain has advanced to ${(result.height) -1};${''
                        } we're now working on ${result.height}`); //we use -1 here since we're printing after the new process
                    }
                }
            });
        }, pollingInterval* 1000);
    }

    const GetBlockTemplate = (callback) => {
        const getRawTransaction = (template) => {
            template.miner = parseFloat(template.coinbasetxn.coinbasevalue / Math.pow(10, 8)).toFixed(8);
            _this.daemon.cmd('decoderawtransaction',
                             [template.coinbasetxn.data],
                             async (result) => {
                                if (result.error) {
                                    emitErrorLog(`decoderawtransaction call failed for daemon instance ${result.instance.index} with error ${JSON.stringify(result.error)}`);
                                    callback(result.error);
                                } else {
                                    template.vouts = result.response.vout;
                                    let processedNewBlock = await _this.jobManager.processTemplate(template);
                                    callback(null, template, processedNewBlock);
                                    callback = () => {};
                                    if (processedNewBlock && _this.varDiff) {
                                        Object.keys(_this.varDiff).forEach((port) => { _this.varDiff[port].setNetworkDifficulty(_this.jobManager.currentJob.difficulty) });
                                    }
                                };
                            }, true);
        };

        const getBlockTemplateAndRawCoinbase = () => {
            let isRrDefined = (rRthing) => (typeof(rRthing) !== 'undefined' && typeof(rRthing) !== 'null');
            _this.daemon.cmd('getblocktemplate',
                             [ { "capabilities": ["coinbasetxn", "workid", "coinbase/append"] }],
                            (result) => {
                                if (result.error) {
                                    emitErrorLog(`getblocktemplate call failed for daemon instance ${result.instance.index} with error ${JSON.stringify(result.error)}`);
                                    callback(result.error);
                                } else if (!isRrDefined(result[0].response) || !isRrDefined(result[0].response.coinbasetxn)) {
                                    emitErrorLog(`getblocktemplate call failed for daemon with error: ${JSON.stringify(result)}`);
                                    getBlockTemplateAndRawCoinbase();
                                } else {
                                    getRawTransaction(result[0].response);
                                }
                            });
        };
        getBlockTemplateAndRawCoinbase();
    }

    const CheckBlockAccepted = (blockHash, callback) => {
        setTimeout(() => {
            _this.daemon.cmd('getblock', [blockHash],
                (results) => {
                    
                    var validResults = results.filter((result) => (result.response, (result.response.hash === blockHash)));
                    if (validResults.length >= 1) {
                        emitWarningLog(`CheckBlockAccepted: ${validResults[0].response.height} accepted as: ${validResults[0].response.hash}`);
                        callback(true, validResults[0].response.tx[0]);
                    } else {
                        emitErrorLog(`CheckBlockAccepted: ${JSON.stringify(results.error)}`);
                        callback(false);
                    }
                }
            );
        }, 500);
    }

    /**
     * This method is being called from the blockNotify so that when a new block is discovered by the daemon
     * We can inform our miners about the newly found block and scrape for a new template
     **/
    this.processBlockNotify = (blockHash, sourceTrigger) => {

        let isDefined = (jMthing) => (typeof(jMthing) !== 'undefined');

        if (isDefined(_this.jobManager) &&
         isDefined(_this.jobManager.currentJob) &&
         isDefined(_this.jobManager.currentJob.rpcData.previousblockhash) &&
         blockHash !== _this.jobManager.currentJob.rpcData.previousblockhash) {
            
            if (!process.env.forkId || process.env.forkId === '0') {
                setTimeout(() => {
                blockHash = util.reverseHex(blockHash)
                    _this.daemon.cmd('getblock', [blockHash],
                        async (results) => {
                            var validResults = results.filter((result) => (result.response, (result.response.hash === blockHash)));
                            if (validResults.length >= 1) {
                                emitLog(`Notification via ${sourceTrigger}: ${options.coin.name} blockchain has advanced to ${validResults[0].response.height};${''
                                } we're now working on ${validResults[0].response.height+1}`);
                            } else {
                                emitErrorLog(`Notification via ${sourceTrigger} of ${blockHash}; however, the daemon disagrees with it being a block`);
                                return;
                            }
                        }
                    );
                }, 500);
            };

            GetBlockTemplate((error, result) => {
                if (error) { emitErrorLog(`Block notify error getting block template for ${options.coin.name}`); };
            });
        };
    };

    this.relinquishMiners = (filterFn, resultCback) => {
        var origStratumClients = this.stratumServer.getStratumClients();
        var stratumClients = [];
        Object.keys(origStratumClients).forEach((subId) => {
            stratumClients.push({
                subId: subId,
                client: origStratumClients[subId]
            });
        });

        async.filter(stratumClients, filterFn, (err, clientsToRelinquish) => {
            clientsToRelinquish.forEach((cObj) => {
                cObj.client.removeAllListeners();
                _this.stratumServer.removeStratumClientBySubId(cObj.subId);
            });

            process.nextTick(() => {
                resultCback(clientsToRelinquish.map((item) => item.client));
            });
        })
    };


    this.attachMiners = (miners) => {
        miners.forEach((clientObj) => { _this.stratumServer.manuallyAddStratumClient(clientObj); });
        _this.stratumServer.broadcastMiningJobs(_this.jobManager.currentJob.getJobParams());
    };
    this.getStratumServer = () => _this.stratumServer;

    this.setVarDiff = (port, varDiffConfig) => {
        if (typeof(_this.varDiff) === 'undefined') { _this.varDiff = {}; }
        if (typeof(_this.varDiff[port]) != 'undefined' ) { _this.varDiff[port].removeAllListeners(); }

        _this.varDiff[port] = new varDiff(port, varDiffConfig);;
        _this.varDiff[port].on('newDifficulty', (client, newDiff) => {

            /* We request to set the newDiff @ the next difficulty retarget
             (which should happen when a new job comes in - AKA BLOCK) */
            client.enqueueNextDifficulty(newDiff);

            /*if (options.varDiff.mode === 'fast'){
                 //Send new difficulty, then force miner to use new diff by resending the
                 //current job parameters but with the "clean jobs" flag set to false
                 //so the miner doesn't restart work and submit duplicate shares
                client.sendDifficulty(newDiff);
                var job = _this.jobManager.currentJob.getJobParams();
                job[8] = false;
                client.sendMiningJob(job);
            }*/

        });
    };
};
pool.prototype.__proto__ = events.EventEmitter.prototype;
