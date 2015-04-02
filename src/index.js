
(function() {
  'use strict';

  var BREADTH_SIZE = 10;

  angular.module('address-explorer', ['ui.router', 'monospaced.qrcode']).
    config(['$stateProvider', '$urlRouterProvider', appConfig]).
    factory('Seed', ['$q', Seed]).
    factory('Network', ['$rootScope', '$q', 'Seed', Network]).
    filter('satoshi2', satoshi2).
    controller('HeaderController', ['$scope', '$rootScope', '$state', 'Seed', headerController]).
    controller('BrowserController', ['$scope', '$rootScope', '$stateParams', '$state', 'Seed', 'Network', browserController]).
    controller('AddressController', ['$scope', '$rootScope', '$stateParams', '$state', 'Seed', 'Network', addressController]).
    directive('seedValidator', seedValidator);

  function appConfig($stateProvider, $urlRouterProvider) {
    $urlRouterProvider.otherwise('/start/');
    $stateProvider.
      state("start", {
        url: "/start/",
        templateUrl: "partials/start.html"
      });
    $stateProvider.
      state("browse", {
        url: "/browse/",
        templateUrl: "partials/browse.html",
        controller: "BrowserController"
      });
    $stateProvider.
      state("address", {
        url: "/address/:address",
        templateUrl: "partials/address.html",
        controller: "AddressController"
      });
  }
  function Seed($q) {
    var seed = '';
    var hexSeed = '';
    var that = this;
    var rootNode = null;
    return {
      'startWalk': startWalk,
      'walkTree': walkTree,
      'setSeed': setSeed,
      'getSeed': getSeed,
      'parentKeys': parentKeys,
    };
    function setSeed(seed) {
      if (!validateSeed(seed)) {
        return false;
      }
      that.seed = seed;
      that.hexSeed = seed;
      return true;
    }
    function startWalk() {
      that.rootNode = bitcoin.HDNode.fromSeedHex(that.hexSeed);
      walkTree(that.rootNode, 0, 1); // m
      walkTree(that.rootNode.nodes[0], 0, 1); // m0
      walkTree(that.rootNode.nodes[0].nodes[0], 0, BREADTH_SIZE); // m00
    }

    function walkTree(node, start, maxBreadth) {
      console.log('walking ' + maxBreadth);
      if (!node.nodes) {
        node.nodes = [];
      }
      for (var i = start; i < maxBreadth; ++i) {
        var child = node.derive(i);
        child.parent = node;
        node.nodes.push(child);
      }
    }
    function getSeed() {
      return that.seed;
    }
    function parentKeys() {
      var path = [0, 0];
      var m = that.rootNode;
      for (var i = 0; i < path.length; ++i) {
        m = m.nodes[path[i]]; 
      }
      return m;
    }
  }
  function Network($rootScope, $q, Seed) {
    var d = $q.defer();
    var obelisk = new GatewayClient('wss://gateway.unsystem.net', function() {
      console.log('Connect');
      d.resolve();
    }, function() {
      console.log('Disconnect');
      d.reject();
    }, function() {
      console.log('Error');
      d.reject();
    });
    return {
      'fetchAmounts': fetchAmounts,
      'fetchAll': fetchAll,
      'fetchMore': fetchMore
    };
    function fetchAmounts(node) {
      var d = $q.defer();
      fetchHistory(node.getAddress().toString()).then(function(history) {
        var received = 0, sent = 0, txCount = 0;
        var splitHistory = [];
        history.map(function(h) {
          received += h[3];
          sent += h[4] ? h[3] : 0;
          txCount += h[4] ? 2 : 1;

          h.received = h[3];
          h.sent = h[4] ? h[3] : 0;
          h.recvTxid = h[0];
          h.sentTxid = h[4];
        });
        node.fetched = true;
        node.received = received;
        node.sent = sent;
        node.balance = received - sent;
        node.txCount = txCount;
        node.history = history;
        d.resolve(node);
      }, function(error) {
        d.reject(error);
      });
      return d.promise;
    }
    function fetchAll(index, nodes) {
      var d = $q.defer();
      doFetchAll(d, index, nodes);
      return d.promise;
    }
    function fetchMore(nodes) {
      var index = nodes.length;
      Seed.walkTree(nodes[0].parent, index, index + BREADTH_SIZE);
      return fetchAll(index, nodes);
    }
    function doFetchAll(d, index, nodes) {
      if (index < nodes.length) {
        fetchAmounts(nodes[index]).then(function() {
          doFetchAll(d, index + 1, nodes);
        });
      } else {
        var received = 0;
        nodes.slice(nodes.length - 10).map(function(n) {
          received += n.received;
        });
        if (received > 0) {
          Seed.walkTree(nodes[0].parent, nodes.length, nodes.length + BREADTH_SIZE);
          doFetchAll(d, index, nodes);
        } else {
          d.resolve();
        }
      }
    }
    function fetchHistory(address) {
      var p = $q.defer();
      d.promise.then(function() {
        obelisk.fetch_history(address, 0, function(error, history) {
          error ? p.reject(error) : p.resolve(history);
        });
      });
      return p.promise;
    }
  }
  function satoshi2() {
    return function(val, symbol) {
      if (val === undefined) {
        return '';
      }
      var s = (val / 100000.0).toFixed(2);
      if (symbol) {
        s = s + ' mBTC';
      }
      return s;
    };
  }
  function headerController($scope, $rootScope, $state, Seed) {
    $rootScope.showBack = false;
    $scope.loading = false;
    $scope.set = false;
    $scope.start = function() {
      $scope.loading = true;
      if (Seed.setSeed($scope.masterSeed)) {
        Seed.startWalk();
        $state.go("browse");
        $scope.set = true;
      } else {
        $scope.masterSeed = '';
        $scope.loading = false;
        alert("Invalid Seed!");
      }
    };
    $scope.change = function() {
      $scope.masterSeed = '';
      $state.go("start");
      $scope.set = false;
    };
  }
  function browserController($scope, $rootScope, $stateParams, $state, Seed, Network) {
    $rootScope.showBack = false;
    if (!Seed.getSeed()) {
      $state.go("start");
      return;
    }
    $scope.parentKeys = Seed.parentKeys();
    $scope.nodes = $scope.parentKeys.nodes;
    $scope.loading = true;
    Network.fetchAll(0, $scope.nodes).then(function() {
      $scope.loading = false;
    });
    $scope.viewAddress = function(child) {
      $state.go('address', { 'address': child.getAddress().toString() });
    }
    $scope.loadMore = function() {
      $scope.loading = true;
      Network.fetchMore($scope.nodes).then(function() {
        $scope.loading = false;
      });
    };
  }
  function addressController($scope, $rootScope, $stateParams, $state, Seed, Network) {
    $rootScope.showBack = true;
    if (!Seed.getSeed()) {
      $state.go("start");
      return;
    }
    var keys = Seed.parentKeys();
    $scope.address = $stateParams.address;
    for (var i = 0; i < keys.nodes.length; ++i) {
      if (keys.nodes[i].getAddress().toString() === $scope.address) {
        $scope.node = keys.nodes[i];
      }
    }
    if ($scope.node) {
      $scope.wif = $scope.node.privKey.toWIF();
    }
    $scope.history = [];
    $scope.loading = true;
    $scope.addressMode = true;
    $scope.changeMode = function(address) {
      $scope.addressMode = address;
    }
    Network.fetchAmounts($scope.node).then(function(history) {
      $scope.history = $scope.node.history;
      $scope.balance = $scope.node.balance;
      $scope.totalReceived = $scope.node.received;
      $scope.totalSent = $scope.node.sent;
      $scope.txCount = $scope.node.txCount;
      $scope.loading = false;
    }, function(error) {
      $scope.loading = false;
    });
  }
  function validateSeed(hexSeed) {
    try {
      bitcoin.HDNode.fromSeedHex(hexSeed);
    } catch (e) {
      return false;
    }
    return true;
  }
  function seedValidator() {
    return {
      require: 'ngModel',
      link: function(scope, elm, attrs, ctrl) {
        ctrl.$validators.seed = function(s) {
          return validateSeed(s);
        }
      }
    };
  }
})();
