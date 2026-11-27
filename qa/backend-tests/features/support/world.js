const { setWorldConstructor, World } = require('@cucumber/cucumber');

class DevRadarWorld extends World {
  constructor(options) {
    super(options);
    this.app = null;
    this.server = null;
    this.context = null; // the server instance's state (dev/backend/src/serverContext.js), hooks.js
    this.extraInstances = []; // more backend instances (testApp.js startTestInstance)
    this.response = null;
    this.sockets = []; // open socket.io-client connections, closed in an After hook
    this.receivedEvents = {}; // socketAlias -> [{event, payload}]
  }
}

setWorldConstructor(DevRadarWorld);
