var net = require('net');
var events = require('events');

var listener = module.exports = function listener(port)
{
    var _this = this;
    var emitLog = (text) => {
        _this.emit('log', text);
    };
    function isJson(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }

    this.start = () => {
        net.createServer((c) => {
            var data = '';
            try {
                c.on('data', (d) => {
                    if (isJson(d.toString())) {
                        data += d;
                        if (data.slice(-1) === '\n') {
                            var message = JSON.parse(data);
                            _this.emit('command', message.command, message.params, message.options, function(message) {
                                c.end(message);
                            });
                        }
                    } else {
                        c.end(`You must send JSON, not: ${d.toString()}`);
                        return;
                    }
                }).on('end', () => {
                }).on('error', () => {
                });
            } catch(e) {
                emitLog(`CLI listener failed to parse message ${data}`);
            }

        }).listen(port, '127.0.0.1', () => {
            emitLog(`CLI listening on port ${port}`)
        });
    }
};

listener.prototype.__proto__ = events.EventEmitter.prototype;
