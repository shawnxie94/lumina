(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
})();
function print(method, ...args) {
  if (typeof args[0] === "string") {
    const message = args.shift();
    method(`[wxt] ${message}`, ...args);
  } else {
    method("[wxt]", ...args);
  }
}
var logger = {
  debug: (...args) => print(console.debug, ...args),
  log: (...args) => print(console.log, ...args),
  warn: (...args) => print(console.warn, ...args),
  error: (...args) => print(console.error, ...args)
};
function setupWebSocket(onMessage) {
  const serverUrl = `${"ws:"}//${"localhost"}:${3e3}`;
  logger.debug("Connecting to dev server @", serverUrl);
  const ws = new WebSocket(serverUrl, "vite-hmr");
  ws.addEventListener("open", () => {
    logger.debug("Connected to dev server");
  });
  ws.addEventListener("close", () => {
    logger.debug("Disconnected from dev server");
  });
  ws.addEventListener("error", (event) => {
    logger.error("Failed to connect to dev server", event);
  });
  ws.addEventListener("message", (e) => {
    var _a, _b;
    try {
      const message = JSON.parse(e.data);
      if (message.type === "custom" && ((_b = (_a = message.event) == null ? void 0 : _a.startsWith) == null ? void 0 : _b.call(_a, "wxt:"))) {
        onMessage == null ? void 0 : onMessage(message);
      }
    } catch (err) {
      logger.error("Failed to handle message", err);
    }
  });
  return ws;
}
{
  try {
    setupWebSocket((message) => {
      if (message.event === "wxt:reload-page") {
        if (message.data === location.pathname.substring(1)) {
          location.reload();
        }
      }
    });
  } catch (err) {
    logger.error("Failed to setup web socket connection with dev server", err);
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicG9wdXAtRGt1blNxNkkuanMiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL25vZGVfbW9kdWxlcy93eHQvZGlzdC92aXJ0dWFsL3JlbG9hZC1odG1sLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIHNyYy9zYW5kYm94L3V0aWxzL2xvZ2dlci50c1xuZnVuY3Rpb24gcHJpbnQobWV0aG9kLCAuLi5hcmdzKSB7XG4gIGlmIChpbXBvcnQubWV0YS5lbnYuTU9ERSA9PT0gXCJwcm9kdWN0aW9uXCIpXG4gICAgcmV0dXJuO1xuICBpZiAodHlwZW9mIGFyZ3NbMF0gPT09IFwic3RyaW5nXCIpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gYXJncy5zaGlmdCgpO1xuICAgIG1ldGhvZChgW3d4dF0gJHttZXNzYWdlfWAsIC4uLmFyZ3MpO1xuICB9IGVsc2Uge1xuICAgIG1ldGhvZChcIlt3eHRdXCIsIC4uLmFyZ3MpO1xuICB9XG59XG52YXIgbG9nZ2VyID0ge1xuICBkZWJ1ZzogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZGVidWcsIC4uLmFyZ3MpLFxuICBsb2c6ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLmxvZywgLi4uYXJncyksXG4gIHdhcm46ICguLi5hcmdzKSA9PiBwcmludChjb25zb2xlLndhcm4sIC4uLmFyZ3MpLFxuICBlcnJvcjogKC4uLmFyZ3MpID0+IHByaW50KGNvbnNvbGUuZXJyb3IsIC4uLmFyZ3MpXG59O1xuXG4vLyBzcmMvdmlydHVhbC91dGlscy9zZXR1cC13ZWItc29ja2V0LnRzXG5mdW5jdGlvbiBzZXR1cFdlYlNvY2tldChvbk1lc3NhZ2UpIHtcbiAgY29uc3Qgc2VydmVyVXJsID0gYCR7X19ERVZfU0VSVkVSX1BST1RPQ09MX199Ly8ke19fREVWX1NFUlZFUl9IT1NUTkFNRV9ffToke19fREVWX1NFUlZFUl9QT1JUX199YDtcbiAgbG9nZ2VyLmRlYnVnKFwiQ29ubmVjdGluZyB0byBkZXYgc2VydmVyIEBcIiwgc2VydmVyVXJsKTtcbiAgY29uc3Qgd3MgPSBuZXcgV2ViU29ja2V0KHNlcnZlclVybCwgXCJ2aXRlLWhtclwiKTtcbiAgd3MuYWRkRXZlbnRMaXN0ZW5lcihcIm9wZW5cIiwgKCkgPT4ge1xuICAgIGxvZ2dlci5kZWJ1ZyhcIkNvbm5lY3RlZCB0byBkZXYgc2VydmVyXCIpO1xuICB9KTtcbiAgd3MuYWRkRXZlbnRMaXN0ZW5lcihcImNsb3NlXCIsICgpID0+IHtcbiAgICBsb2dnZXIuZGVidWcoXCJEaXNjb25uZWN0ZWQgZnJvbSBkZXYgc2VydmVyXCIpO1xuICB9KTtcbiAgd3MuYWRkRXZlbnRMaXN0ZW5lcihcImVycm9yXCIsIChldmVudCkgPT4ge1xuICAgIGxvZ2dlci5lcnJvcihcIkZhaWxlZCB0byBjb25uZWN0IHRvIGRldiBzZXJ2ZXJcIiwgZXZlbnQpO1xuICB9KTtcbiAgd3MuYWRkRXZlbnRMaXN0ZW5lcihcIm1lc3NhZ2VcIiwgKGUpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IEpTT04ucGFyc2UoZS5kYXRhKTtcbiAgICAgIGlmIChtZXNzYWdlLnR5cGUgPT09IFwiY3VzdG9tXCIgJiYgbWVzc2FnZS5ldmVudD8uc3RhcnRzV2l0aD8uKFwid3h0OlwiKSkge1xuICAgICAgICBvbk1lc3NhZ2U/LihtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZ2dlci5lcnJvcihcIkZhaWxlZCB0byBoYW5kbGUgbWVzc2FnZVwiLCBlcnIpO1xuICAgIH1cbiAgfSk7XG4gIHJldHVybiB3cztcbn1cblxuLy8gc3JjL3ZpcnR1YWwvcmVsb2FkLWh0bWwudHNcbmlmIChpbXBvcnQubWV0YS5lbnYuQ09NTUFORCA9PT0gXCJzZXJ2ZVwiKSB7XG4gIHRyeSB7XG4gICAgc2V0dXBXZWJTb2NrZXQoKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChtZXNzYWdlLmV2ZW50ID09PSBcInd4dDpyZWxvYWQtcGFnZVwiKSB7XG4gICAgICAgIGlmIChtZXNzYWdlLmRhdGEgPT09IGxvY2F0aW9uLnBhdGhuYW1lLnN1YnN0cmluZygxKSkge1xuICAgICAgICAgIGxvY2F0aW9uLnJlbG9hZCgpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZ2dlci5lcnJvcihcIkZhaWxlZCB0byBzZXR1cCB3ZWIgc29ja2V0IGNvbm5lY3Rpb24gd2l0aCBkZXYgc2VydmVyXCIsIGVycik7XG4gIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQ0EsU0FBUyxNQUFNLFdBQVcsTUFBTTtBQUc5QixNQUFJLE9BQU8sS0FBSyxDQUFDLE1BQU0sVUFBVTtBQUMvQixVQUFNLFVBQVUsS0FBSyxNQUFBO0FBQ3JCLFdBQU8sU0FBUyxPQUFPLElBQUksR0FBRyxJQUFJO0FBQUEsRUFDcEMsT0FBTztBQUNMLFdBQU8sU0FBUyxHQUFHLElBQUk7QUFBQSxFQUN6QjtBQUNGO0FBQ0EsSUFBSSxTQUFTO0FBQUEsRUFDWCxPQUFPLElBQUksU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7QUFBQSxFQUNoRCxLQUFLLElBQUksU0FBUyxNQUFNLFFBQVEsS0FBSyxHQUFHLElBQUk7QUFBQSxFQUM1QyxNQUFNLElBQUksU0FBUyxNQUFNLFFBQVEsTUFBTSxHQUFHLElBQUk7QUFBQSxFQUM5QyxPQUFPLElBQUksU0FBUyxNQUFNLFFBQVEsT0FBTyxHQUFHLElBQUk7QUFDbEQ7QUFHQSxTQUFTLGVBQWUsV0FBVztBQUNqQyxRQUFNLFlBQVksR0FBRyxLQUF1QixLQUFLLFdBQXVCLElBQUksR0FBbUI7QUFDL0YsU0FBTyxNQUFNLDhCQUE4QixTQUFTO0FBQ3BELFFBQU0sS0FBSyxJQUFJLFVBQVUsV0FBVyxVQUFVO0FBQzlDLEtBQUcsaUJBQWlCLFFBQVEsTUFBTTtBQUNoQyxXQUFPLE1BQU0seUJBQXlCO0FBQUEsRUFDeEMsQ0FBQztBQUNELEtBQUcsaUJBQWlCLFNBQVMsTUFBTTtBQUNqQyxXQUFPLE1BQU0sOEJBQThCO0FBQUEsRUFDN0MsQ0FBQztBQUNELEtBQUcsaUJBQWlCLFNBQVMsQ0FBQyxVQUFVO0FBQ3RDLFdBQU8sTUFBTSxtQ0FBbUMsS0FBSztBQUFBLEVBQ3ZELENBQUM7QUFDRCxLQUFHLGlCQUFpQixXQUFXLENBQUMsTUFBTTs7QUFDcEMsUUFBSTtBQUNGLFlBQU0sVUFBVSxLQUFLLE1BQU0sRUFBRSxJQUFJO0FBQ2pDLFVBQUksUUFBUSxTQUFTLGNBQVksbUJBQVEsVUFBUixtQkFBZSxlQUFmLDRCQUE0QixVQUFTO0FBQ3BFLCtDQUFZO0FBQUEsTUFDZDtBQUFBLElBQ0YsU0FBUyxLQUFLO0FBQ1osYUFBTyxNQUFNLDRCQUE0QixHQUFHO0FBQUEsSUFDOUM7QUFBQSxFQUNGLENBQUM7QUFDRCxTQUFPO0FBQ1Q7QUFHeUM7QUFDdkMsTUFBSTtBQUNGLG1CQUFlLENBQUMsWUFBWTtBQUMxQixVQUFJLFFBQVEsVUFBVSxtQkFBbUI7QUFDdkMsWUFBSSxRQUFRLFNBQVMsU0FBUyxTQUFTLFVBQVUsQ0FBQyxHQUFHO0FBQ25ELG1CQUFTLE9BQUE7QUFBQSxRQUNYO0FBQUEsTUFDRjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0gsU0FBUyxLQUFLO0FBQ1osV0FBTyxNQUFNLHlEQUF5RCxHQUFHO0FBQUEsRUFDM0U7QUFDRjsiLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMF19
