import { isPlainObject } from "lodash";
import { Action } from "redux";
import {
  INIT,
  Listener,
  ProxyStore,
  ProxyStoreEnhancer,
  RECEIVE_MESSAGE,
  UPDATE_STATE,
} from "./types";

export default function createProxyStore<S>(
  worker: Worker,
  preloadedState?: S | ProxyStoreEnhancer<S>,
  enhancer?: ProxyStoreEnhancer<S>
): ProxyStore<S> {
  if (typeof preloadedState === "function" && enhancer === undefined) {
    enhancer = preloadedState; // tslint:disable-line:no-param-reassign
    preloadedState = undefined; // tslint:disable-line:no-param-reassign
  }

  if (enhancer !== undefined) {
    if (typeof enhancer !== "function") {
      throw new Error("Expected the enhancer to be a function.");
    }

    return enhancer(createProxyStore)(worker, preloadedState as S);
  }

  let currentState = preloadedState as S;
  let listeners: Listener[] = [];
  let readyResolve: Function;
  let readyResolved = false;

  // tslint:disable-next-line: promise-must-complete
  const readyPromise = new Promise(resolve => (readyResolve = resolve));

  function getState() {
    return currentState;
  }

  function subscribe(listener: Listener) {
    if (typeof listener !== "function") {
      throw new Error("Expected listener to be a function.");
    }

    listeners.push(listener);

    function unsubscribe() {
      listeners = listeners.filter(l => l !== listener);
    }

    return unsubscribe;
  }

  async function dispatch(action: Action) {
    if (!isPlainObject(action)) {
      throw new Error(
        "Actions must be plain objects. " +
          "Use custom middleware for async actions."
      );
    }

    if (typeof action.type === undefined) {
      throw new Error(
        'Actions may not have an undefined "type" property.' +
          "Have you misspelled a constant?"
      );
    }

    worker.postMessage(action);
  }

  function destroy() {
    worker.removeEventListener(
      RECEIVE_MESSAGE,
      _handleReceiveMessageFromWorker
    );

    worker.terminate();
  }

  function start() {
    worker.addEventListener(RECEIVE_MESSAGE, _handleReceiveMessageFromWorker);

    // When a store is created, an "INIT" action is dispatched so that every
    // reducer returns their initial state. This effectively populates
    // the initial state tree.
    dispatch({ type: INIT });
  }

  function ready(cb?: () => void) {
    if (cb !== undefined) {
      return readyPromise.then(cb);
    }

    return readyPromise;
  }

  function _replaceState(nextState: S) {
    currentState = nextState;

    listeners.forEach(listener => listener());
  }

  function _handleReceiveMessageFromWorker(event: MessageEvent) {
    const action = event.data;
    if (action.type === UPDATE_STATE) {
      const nextState = action.payload.state;

      _replaceState(nextState);

      if (!readyResolved) {
        readyResolved = true;
        readyResolve();
      }
    }
  }

  start();

  return { getState, subscribe, dispatch, destroy, start, ready };
}
