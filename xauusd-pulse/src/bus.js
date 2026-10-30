const EventEmitter = require('events');
const bus = new EventEmitter();
// Tell connected browsers that a part of the dashboard has new data.
bus.notify = (type) => bus.emit('update', { type });
module.exports = bus;
