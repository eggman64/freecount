import {attachRoutes, dispatch, generateId, goTo} from './lib.js'
import JsonForm from '/js/components/JsonForm.js'
import InitTripForm from '/js/components/InitTripForm.js'
import PasswordInputForm from '/js/components/PasswordInputForm.js'
import AddExpenseForm from '/js/components/AddExpenseForm.js'
import ItemList from '/js/components/ItemList.js'

import Client, {sync, postCommand, parseAndDispatch} from './client.js'

import {checkPull, updateMenu} from './handlers/general.js'
import {showKnownTrips} from './handlers/setupPage.js'
import * as exp from './handlers/expenses.js'
import {
  onInitTrip as balanceOnInitTrip,
  onNewExpense as balanceOnNewExpense
} from './handlers/balance.js'

const routes = [
  // Navigation
  ['click -> [to]', ({target}) => goTo(target.getAttribute('to'))],

  // Generic interaction helpers
  ['click => menu', updateMenu],
  ['app:syncerror', ({detail}) => alert(detail)],
  ['app:http_request_start', ({currentTarget}) => currentTarget.classList.add('loading')],
  ['app:http_request_stop', ({currentTarget}) => currentTarget.classList.remove('loading')],

  // App logic
  ['click => #refresh_button', exp.onRefreshButtonClicked],
  ['app:knowntrips', showKnownTrips],
  ['app:submit_init_trip', exp.initTrip],
  ['app:navigate => [path="/add_expense"]', exp.onAddExpenseFormOpen],
  ['app:submit_add_expense', exp.addExpense],
  ['app:did_init_trip', exp.onTripReady],
  ['app:did_init_trip', balanceOnInitTrip],
  ['app:did_add_expense', exp.onNewExpense],
  ['app:just_did_add_expense', exp.onImmediateNewExpense],
  ['app:failed_to_add_expense', exp.onLocalNewExpense],
  ['app:sync', exp.clearLocal],
  ['app:did_add_expense', balanceOnNewExpense],
  ['touchstart => h1,[path="/trip"]', checkPull],
  ['app:pulldown', () => dispatch(document.body, 'app:sync')],
  ['app:start', exp.toggleRefreshButton]
]

export default function main() {
  const params = new URLSearchParams(window.location.search)
  const boxId = params.get('box') || generateId(32)
  const client = new Client(boxId)

  customElements.define('item-list', ItemList)
  customElements.define('json-form', JsonForm)
  customElements.define('init-trip-form', InitTripForm)
  customElements.define('password-input-form', PasswordInputForm)
  customElements.define('add-expense-form', AddExpenseForm)

  withStored('known_trips', {}, knownTrips => {
    const encryptionKey = knownTrips[boxId] && knownTrips[boxId].key
    if (encryptionKey) {
      client.setKey(encryptionKey)
    }
  })

  attachRoutes(routes, document.body)

  if (params.has('box')) {
    dispatch(document.body, 'app:sync')
  } else {
    goTo('/setup')
  }

  // Add statefull listeners
  attachRoutes([
    ['app:sync', sync(client)],
    ['app:postcommand', postCommand(client)],
    ['app:just_did_init_trip', () => {
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.set('box', boxId)
      window.location.assign(newUrl.href)
    }],
    ['app:did_init_trip', ({detail}) => {
      document.title = `${detail.name} | Freecount`
      goTo('/trip/expenses')
      persist('known_trips', {}, knownTrips => {
        const currentValue = knownTrips[boxId] || {}
        return Object.assign({}, knownTrips, {[boxId]: {...currentValue, title: detail.name}})
      })
    }],
    ['app:navigate -> [path="/setup"]', ({target, detail}) => {
      withStored('known_trips', {}, dispatch.bind(null, target, 'app:knowntrips'))
    }],
    ['app:did_unauthorized', () => {
      goTo('/password_input')
    }],
    ['app:submit_password_input', ({detail, target}) => {
      client.setKey(detail)
      dispatch(target, 'app:sync')
      persist('known_trips', {}, knownTrips => {
        const currentValue = knownTrips[boxId] || {}
        return Object.assign({}, knownTrips, {[boxId]: {...currentValue, key: detail}})
      })
    }],
    ['app:encryptionkeyupdate', ({detail}) => {
      client.setKey(detail)
      persist('known_trips', {}, knownTrips => {
        const currentValue = knownTrips[boxId] || {}
        return Object.assign({}, knownTrips, {[boxId]: {...currentValue, key: detail}})
      })
    }],
    ['app:posterror', ({target, detail}) => {
      const payload = detail.payload
      persist(`${boxId}_commands`, [], commands => [].concat(commands, payload))
      dispatch(target, `app:failed_to_${payload.command}`, payload.data)
    }],
    ['app:sync', ({target, detail}) => {
      persist(`${boxId}_commands`, [], commands => {
        if (commands.length) {
          target.addEventListener('app:http_request_stop', () => {
            commands.forEach(c => postCommand(client)({target, detail: c}))
          }, {once: true})
        }
        return []
      })
    }]
  ], document.body)

  // Launch the start event
  dispatch(document.body, 'app:start')

  // Register the worker
  if ('serviceWorker' in navigator && !params.has('nosw')) {
    registerSW(client)
  }
}

function registerSW(client) {
  navigator.serviceWorker.register('./worker.js')
  .then(reg => {
    reg.onupdatefound = () => {
      console.info('A new version of Service Worker available, reloading the page…')
      setTimeout(window.location.reload(), 100)
    }
    console.info('Service Worker registered… Offline support active')
  })
  .catch((error) => {
    console.error(`Registration failed with ${error}`)
  })

  navigator.serviceWorker.addEventListener('message', event => {
    parseAndDispatch(client, document.body, event.data) && client.offset++
  })
}

function withStored(storageKey, default_, fn) {
  if (localStorage.hasOwnProperty(storageKey)) {
    fn(backport(storageKey, JSON.parse(localStorage.getItem(storageKey))))
  } else {
    fn(default_)
  }
}

function persist(storageKey, default_, fn) {
  withStored(storageKey, default_, item => {
    localStorage.setItem(storageKey, (JSON.stringify(fn(item))))
  })
}

// Turn old stored format into a new one
function backport(key, item) {
  switch(key) {
    case 'known_trips':
      return Object.getOwnPropertyNames(item)
        .map(k => [k, item[k]])
        .map(([k, v]) => typeof v === 'string' ? [v, { title: k }] : [k, v])
        .reduce((map, [k, v]) => Object.assign(map, {[k]: v}), {})
    default:
      return item
  }
}
