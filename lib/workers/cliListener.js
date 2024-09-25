var events = require('events');
var net = require('net');

var listener = module.exports = function listener(port)
{
    var _this = this;
    var emitLog = function(text) {
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

    this.start = function() {
        net.createServer(function(c) {
            var data = '';
            try {
                c.on('data', function (d) {
                    if (isJson(d.toString())) {
                        data += d;
                        if (data.slice(-1) === '\n') {
                            var message = JSON.parse(data);
                            _this.emit('command', message.command, message.params, message.options, function(message) {
                                c.end(message);
                            });
                        }
                    } else {
                        c.end('You must send JSON, not: '+d.toString());
                        return;
                    }
                });
                c.on('end', function () {});
                c.on('error', function () {});
            } catch(e) {
                emitLog('CLI listener failed to parse message ' + data);
            }

        }).listen(port, '127.0.0.1', function() {
            emitLog('CLI listening on port ' + port)
        });
    }
};

listener.prototype.__proto__ = events.EventEmitter.prototype;
