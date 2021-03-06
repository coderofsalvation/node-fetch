/**
 * response.js
 *
 * Response class provides content decoding
 */

var convert = require('encoding').convert;

module.exports = Body;

/**
 * Response class
 *
 * @param   Stream  body  Readable stream
 * @param   Object  opts  Response options
 * @return  Void
 */
function Body(body, opts) {

    opts = opts || {};

    this.body = body;
    this.bodyUsed = false;
    this.size = opts.size || 0;
    this.timeout = opts.timeout || 0;
    this._raw = [];
    this._abort = false;

}

/**
 * Decode response as json
 *
 * @return  Promise
 */
Body.prototype.json = function() {

    return this._decode().then(function(text) {
        return JSON.parse(text);
    });

};

/**
 * Decode response as text
 *
 * @return  Promise
 */
Body.prototype.text = function() {

    return this._decode();

};

/**
 * Decode buffers into utf-8 string
 *
 * @return  Promise
 */
Body.prototype._decode = function() {

    var self = this;

    if (this.bodyUsed) {
        return Body.Promise.reject(new Error('body used already for: ' + this.url));
    }

    this.bodyUsed = true;
    this._bytes = 0;
    this._abort = false;
    this._raw = [];

    return new Body.Promise(function(resolve, reject) {
        var resTimeout;

        if (typeof self.body === 'string') {
            self._bytes = self.body.length;
            self._raw = [new Buffer(self.body)];
            return resolve(self._convert());
        }

        if (self.body instanceof Buffer) {
            self._bytes = self.body.length;
            self._raw = [self.body];
            return resolve(self._convert());
        }

        // allow timeout on slow response body
        if (self.timeout) {
            resTimeout = setTimeout(function() {
                self._abort = true;
                reject(new Error('response timeout at ' + self.url + ' over limit: ' + self.timeout));
            }, self.timeout);
        }

        // handle stream error, such as incorrect content-encoding
        self.body.on('error', function(err) {
            reject(new Error('invalid response body at: ' + self.url + ' reason: ' + err.message));
        });

        self.body.on('data', function(chunk) {
            if (self._abort || chunk === null) {
                return;
            }

            if (self.size && self._bytes + chunk.length > self.size) {
                self._abort = true;
                reject(new Error('content size at ' + self.url + ' over limit: ' + self.size));
                return;
            }

            self._bytes += chunk.length;
            self._raw.push(chunk);
        });

        self.body.on('end', function() {
            if (self._abort) {
                return;
            }

            clearTimeout(resTimeout);
            resolve(self._convert());
        });
    });

};

/**
 * Detect buffer encoding and convert to target encoding
 * ref: http://www.w3.org/TR/2011/WD-html5-20110113/parsing.html#determining-the-character-encoding
 *
 * @param   String  encoding  Target encoding
 * @return  String
 */
Body.prototype._convert = function(encoding) {

    encoding = encoding || 'utf-8';

    var charset = 'utf-8';
    var res, str;

    // header
    if (this.headers.has('content-type')) {
        res = /charset=([^;]*)/i.exec(this.headers.get('content-type'));
    }

    // no charset in content type, peek at response body
    if (!res && this._raw.length > 0) {
        str = this._raw[0].toString().substr(0, 1024);
    }

    // html5
    if (!res && str) {
        res = /<meta.+?charset=(['"])(.+?)\1/i.exec(str);
    }

    // html4
    if (!res && str) {
        res = /<meta[\s]+?http-equiv=(['"])content-type\1[\s]+?content=(['"])(.+?)\2/i.exec(str);

        if (res) {
            res = /charset=(.*)/i.exec(res.pop());
        }
    }

    // xml
    if (!res && str) {
        res = /<\?xml.+?encoding=(['"])(.+?)\1/i.exec(str);
    }

    // found charset
    if (res) {
        charset = res.pop();

        // prevent decode issues when sites use incorrect encoding
        // ref: https://hsivonen.fi/encoding-menu/
        if (charset === 'gb2312' || charset === 'gbk') {
            charset = 'gb18030';
        }
    }

    // turn raw buffers into utf-8 string
    return convert(
        Buffer.concat(this._raw)
        , encoding
        , charset
    ).toString();

};

// expose Promise
Body.Promise = global.Promise;