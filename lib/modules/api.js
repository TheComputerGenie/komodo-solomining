var fs = require('fs');
var logging = require('./logging.js');

module.exports = function(method, obj)
{
    var forkId = process.env.forkId;
    var config = JSON.parse(process.env.config);
    var csymbol = config.coin.symbol;
    if (method === "block") {
        fs.readFile(`./logs/${csymbol}_blocks.json`, 'utf8', updateBlocksJSON);
        function updateBlocksJSON(err, data) {
            if (err) {
                if (err.code === "ENOENT") {
                    createBlocksJSON(obj)
                } else {
                    logging('API', 'error', err)
                }
            }
            var object = JSON.parse(data)
            object.push(obj)
            fs.writeFile(`./logs/${csymbol}_blocks.json`, JSON.stringify(object), done)
        }
        function createBlocksJSON(data) { fs.writeFile(`./logs/${csymbol}_blocks.json`, JSON.stringify(array), done) }
        function done(err) {
            if (err) { logging('API', 'error', err) }
            //logging('Api', 'debug', `Done updating logs/${csymbol}_blocks.json`);
        }
    }
    if (method === "stats") { }
    if (method === "live_stats") { }
}
