(function () {
  function createOfflineSocket() {
    return {
      offline: true,
      id: null,
      on: function () {},
      emit: function () {},
      disconnect: function () {}
    };
  }

  window.io = function () {
    return createOfflineSocket();
  };
})();