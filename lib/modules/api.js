const { writeFile, readFile } = require('fs');
var logging = require('./logging.js');

module.exports = function(method, obj)
{
    var config = JSON.parse(process.env.config);
    var csymbol = config.coin.symbol;
    var emitLog = (text) => { logging(' API ', 'gray'  , text); };
    var emitErrorLog = (text) => { logging(' API ', 'error'  , text); };
    const doneWrite = (err) => {
        if (err) {
            emitErrorLog(err);
        }/* else {
            emitLog(`Block written successfully to logs/${csymbol}_blocks.json`);
        }*/;
    };
    if (method === "block") {
        readFile(`./logs/${csymbol}_blocks.json`, 'utf8', (err, data) => {
            if (err) {
                if (err.code === "ENOENT") {
                    let arr = [];
                    writeFile(`./logs/${csymbol}_blocks.json`, JSON.stringify(arr), doneWrite);
                } else {
                    emitErrorLog(err);
                };
            };
            var object = JSON.parse(data);
            object.push(obj);
            writeFile(`./logs/${csymbol}_blocks.json`, JSON.stringify(object), doneWrite);
        });
    };
}
