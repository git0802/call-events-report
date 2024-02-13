/**
 * Returns a deferred Promise decorated with resolve() and reject() method
 */
function promise() {
    var resolve_, reject_;

    var promise = new Promise(function(resolve, reject) {
        resolve_ = resolve;
        reject_ = reject;
    });

    promise.resolve = function(val) {
        (val === undefined) ? resolve_() : resolve_(val);
        return promise;
    }

    promise.reject = function(reason) {
        (reason === undefined) ? reject_() : reject_(reason);
        return promise;
    }

    return promise;
}

export default {
    promise
}
