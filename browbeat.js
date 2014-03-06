//
// # Browbeat
//

var Browbeat = (function () {
  var HEARTBEAT_KEY      = '_browbeat_heartbeat';
  var ELECTION_KEY       = '_browbeat_election';
  var ELECTION_START_KEY = '_browbeat_election_start';
  var CURRENT_KEY        = '_browbeat_currentMaster';
  var KEY_PREFIX         = '_browbeat_';

  var Browbeat = function Browbeat() {
    this.id              = Math.random() * 1000;
    this.store           = window.localStorage || false;
    this.isMaster        = false;
    this.sanityTimer     = null;
    this.heartbeatTimer  = null;
    this.heartbeatTTL    = 2000;
    this.heartbeatOffset = Math.random() * 10 + 500;
    this.electionTime    = 2000;
    this.listeners       = {};
    this.debug           = true;

    this.init();
  };

  Browbeat.prototype.log = function () {
    var args = Array.prototype.slice.call(arguments, 0);
    args.unshift('[Browbeat]');
    if (this.debug) console.log.apply(console, args);
  };

  Browbeat.prototype.init = function browbeatInit() {
    this.log('ID:', this.id);
    // No store means no support, make it the master
    if (!this.store) {
      return this.becomeMaster();
    }

    // Hook up storage event listener
    var self = this;
    function handler(event) { self.storageEvent(event); }
    if (window.addEventListener) {
      window.addEventListener('storage', handler, false);
    }
    else {
      window.attachEventListener('storage', handler);
    }

    // Check for ongoing election
    var now = (new Date()).getTime();
    var lastHearbeat = this.store.getItem(HEARTBEAT_KEY) || 0;
    var election = this.store.getItem(ELECTION_KEY);
    var started = this.store.getItem(ELECTION_START_KEY);
    if (election && (now - started) < this.electionTime) {
      this.log('Ongoing election, casting vote');
      return this.castVote();
    }
    // Check for heartbeat, if fresh, become slave.
    else if (now - lastHearbeat < this.heartbeatTTL) {
      this.log('Found fresh heartbeat');
      return this.becomeSlave();
    }
    // Start election
    else {
      return this.startElection();
    }
  };

  //
  // ## Handle Storage Event
  //
  // The storage event is used as a message bus between all open tabs. Thus
  // this method acts as kind of a message dispatcher.
  //
  Browbeat.prototype.storageEvent = function browbeatEventHandler(event) {
    var key = event.key;
    if (key.indexOf(KEY_PREFIX) !== 0) {
      return;
    }

    // Handle election events.
    if (key === ELECTION_KEY) {
      // No previous value means a new election was initiated, cast our vote.
      if (event.oldValue === null) {
        clearTimeout(this.heartbeatTimer);
        clearTimeout(this.sanityTimer);
        this.castVote();
      }
    }

    if (key === CURRENT_KEY) {
      if (event.newValue === this.id.toString()) {
        this.becomeMaster();
      }
      else {
        this.becomeSlave();
      }
    }

    // Handle heartbeat events. Check for dead masters.
    if (!this.isMaster && key === HEARTBEAT_KEY) {
      var self = this;
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = setTimeout(function () {
        self.startElection();
      }, this.heartbeatTTL + this.heartbeatOffset);
    }


    //this.log('browbeat event', event);
  };

  // -------------------------------------------------------------------------

  //
  // ## Become Master
  //
  // Becomes the master window. Initiate heartbeat and emit event.
  //
  Browbeat.prototype.becomeMaster = function browbeatElected() {
    this.log('Became master');
    var self = this;
    this.isMaster = true;
    this.emit('browbeatWonElection');
    this.heartbeatTimer = setInterval(function heartbeat() {
      self.store.setItem(HEARTBEAT_KEY, (new Date()).getTime());
    }, this.heartbeatTTL / 2);
  };

  Browbeat.prototype.resign = function browbeatResign() {
    this.isMaster = false;
    clearInterval(this.heartbeatTimer);
  };

  //
  // ## Become Slave
  //
  Browbeat.prototype.becomeSlave = function browbeatBecomeSlave() {
    this.log('Became slave');
    this.isMaster = false;
    this.emit('browbeatLostElection');
    var self = this;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(function () {
      self.startElection();
    }, this.heartbeatTTL + this.heartbeatOffset);
  };

  //
  // ## Cast Vote
  //
  // Add this browbeat's id to the pool of candidates.
  //
  Browbeat.prototype.castVote = function browbeatVote() {
    clearTimeout(this.sanityTimer);
    this.log('Casting vote');
    var votes = this.store.getItem(ELECTION_KEY);
    votes = votes ? votes.split(',') : [];
    votes.push(this.id);
    this.store.setItem(ELECTION_KEY, votes);

    // Sometimes the initiating window will disappear before the election is
    // completed. To avoid a stalemate add a sanity check here.
    var self = this;
    this.sanity = setTimeout(function () {
      if (!self.store.getItem(CURRENT_KEY)) {
        self.startElection();
      }
    }, this.electionTime + this.heartbeatOffset);
  };

  //
  // ## Start Election
  //
  // Initiates a new election by writing to the localStorage. Since storage
  // events are not emitted to the window that initiated the event this method
  // also casts a vote.
  //
  Browbeat.prototype.startElection = function browbeatStartElection() {
    this.log('Initiating election');

    var self = this;
    this.store.removeItem(CURRENT_KEY);
    this.store.removeItem(HEARTBEAT_KEY);
    this.castVote();
    this.store.setItem(ELECTION_START_KEY, (new Date()).getTime());
    setTimeout(function endElection() {
      var candidates = self.store.getItem(ELECTION_KEY);
      candidates = candidates ? candidates.split(',') : [self.id];
      var winner = Math.max.apply(Math, candidates);
      self.store.setItem(CURRENT_KEY, winner);
      self.store.removeItem(ELECTION_KEY);
      self.store.removeItem(ELECTION_START_KEY);
      if (winner === self.id) {
        self.becomeMaster();
      }
    }, this.electionTime);
  };

  // -------------------------------------------------------------------------

  //
  // ## On Event
  //
  // Custom event emitter functionality. Attach a handler to the given event.
  //
  Browbeat.prototype.on = function browbeatEventOn(e, handler) {
    if (!this.listeners[e]) {
      this.listeners[e] = [];
    }

    this.listeners[e].push(handler);
  };

  //
  // ## Emit Event
  //
  // Emits an event to the registered listeners.
  //
  Browbeat.prototype.emit = function browbeatEventEmit(e, data) {
    if (!this.listeners[e]) return;
    data = data || {};
    data.eventName = e;
    for (var i in listeners[e]) {
      listeners[e][i](data);
    }
  };

  return Browbeat;
}());

window.browbeat = new Browbeat();
