
:large_blue_diamond: config.json (or COINX_config.json)

| Key      | Example Value      | Meaning      |
| :------------- | :------------- | :------------- |
|coin|KMD.json|the file in `coins` directory that defines current used coin|
|printShares|false|`Boolean`: print every share from every miner in the pool's output|
|printHighShares|true|`Boolean`: print if a share that is 50% or higher of the block target was found|
|printNethash|false|`Boolean`: print the estimated network hashrate each time the block template is scraped|
|minDiffAdjust|true|`Boolean`: *true* = use port diff; *false* = don't submit any shares less than the block diff|
|printVarDiffAdjust|false|`Boolean`: print each time a miner's vardiff difficulty is changed|
|printCurrentDiff|false|`Boolean`: print the current block difficulty each time the block template is scraped|
|printSubmissions|true|`Boolean`: print each time the pool submits a block|
|jobRebroadcastTimeout|50|how many seconds apart to ask daemon for newest tx info and give miners new work|
|connectionTimeout|6000000|how many ms to allow a miner to go without sending something back before disconnecting them|
|emitInvalidBlockHashes|false|`Boolean`: doesn't do anything in solo but I'm too lazy to finish stripping it out of the code|
|address|RESWsMfWFvPGGUPGfGgXPgGKWeqVaAtUfy|Your address **for the coin you're mining**|
|pubkey|02592809a25cd27cca40ea6ccb04a40a79b3108d3991761412f12db9773f336078|the pubkey for your address **for the coin you're mining**|
|ports:|||
|<ul>*number*|5332|the port number you want miners to connect to for a given minimum share submission|
|<p><ul><ul>diff|300|the **minimum difficulty** miners must hit for share submission|
|<p><ul><ul>varDiff:||*(optional)*|
|<p><ul><ul><ul>minDiff</ul>|30000|the **lowest** diff you want varDiff to assign|
|<p><ul><ul><ul>maxDiff</ul>|1000000|the **highest** diff you want varDiff to assign|
|<p><ul><ul><ul>targetTime</ul>|20|Try to get 1 share per this many seconds|
|<p><ul><ul><ul>retargetTime</ul>|300|Check to see if we should retarget every this many seconds|
|<p><ul><ul><ul>variancePercent</ul>|30|Allow time to very this % from target without retargeting|
|daemons:|||
|<ul>host|127.0.0.1|the IP address of your daemon|
|<ul>port|7771|the `rpcport` your daemon uses for RPC|
|<ul>user|MyUser|the `rpcuser` for your daemon|
|<ul>password|MyPass|the `rpcpassword` for your daemon|
|p2p:|||
|<ul>enabled|true|`Boolean`: connect to a daemon as a peer|
|<ul>host|127.0.0.1|the IP address of your P2P daemon (this may or may not be the same IP as your RPC daemon)|
|<ul>port|7770|the `port` your daemon uses for P2P|
|<ul>disableTransactions|true|`Boolean`: let the daemon send tx data to the pool the same as any other peer|
|blockRefreshInterval|0|have the pool ask the daemon if there's been a new block found every this many seconds<br>Set to 0 for never if you have a solid P2P connection|
|website:|||
|<ul>enabled|true|`Boolean`: use the included web page to display blocks and finders|
|<ul>host|0.0.0.0|the IP address host your web pages on<br>set to 0.0.0.0 as localhost unless you know what you're doing|
|<ul>port|8088|the port you want to serve the web pages from|
|cliPort|17117|the port you want to use for things like blocknotify|
|clustering:|||
|<ul>enabled|true|`Boolean`: run load-balancing threads|
|<ul>forks|3|the number of threads you want to split workers across|

:small_blue_diamond: coins/PIRATE.json (or coins/COINX.json)

| Key      | Example Value      | Meaning      |
| :------------- | :------------- | :------------- |
|name|Pirate|The name of the coin|
|symbol|ARRR|The coin's ticker symbol|
|nonDexstatsExplorer|https://explorer.pirate.black|The coin's explorer if it isn't `cointicker.explorer.dexstats.info`|
|peerMagic|58e0b617|easiest way to find this is run daemon -- magic.17b6e058 becomes 58e0b617|
|txfee|0.0001|min tx fee -- almost always 0.0001 for Komodo and assetchains -- meaningless for solo|

