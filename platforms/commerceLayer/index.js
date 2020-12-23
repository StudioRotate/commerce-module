import CLayerAuth from '@commercelayer/js-auth'
import axios from 'axios'
import normalize from 'json-api-normalize'
const converter = require('@ridi/object-case-converter')
const { events, products, fetchProducts, getCookie, setCookie, removeCookie } = require('<%= options.corePath %>')

const camelcaseKeys = converter.camelize

// Helpers
const state = {
  _cart: {},
  set cart(value) {
    events.$emit('cart/updated', value)
    this._cart = value
  },
  get cart() {
    return this._cart
  },
}

const cartObject = [
  'shipping_country_code_lock',
  'total_tax_amount_float',
  'total_amount_with_taxes_float',
  'total_amount_float',
  'total_amount_cents',
  'subtotal_amount_cents',
  'status',
  'metadata',
  'subtotal_amount_float',
  'id',
  'shipping_amount_float',
  'token',
  'currency_code',
  'checkout_url',
  'line_items.name',
  'line_items.id',
  'line_items.image_url',
  'line_items.item_type',
  'line_items.quantity',
  'line_items.metadata',
  'line_items.sku_code',
  'line_items.total_amount_cents',
  'line_items.unit_amount_cents',
]

const includes = items => `?include=${items.join(',')}`
const orderIncludes = includes(['line_items'])

// Custom CL client
const client = axios.create({
  baseURL: '<%= options.config.endpoint %>/api',
  headers: {
    Accept: 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
  },
})
client.interceptors.request.use(
  (req) => {
    req.headers.Authorization = `Bearer ${state.token.accessToken}`
    return req
  },
  (error) => {
    return Promise.reject(error)
  },
)
client.interceptors.response.use(
  (res) => {
    return res.data ? normalize(res.data) : res
  },
  (error) => {
    return Promise.reject(error)
  },
)

const formatOrder = (cart) => {
  const unformatted = camelcaseKeys(cart.get(cartObject), { recursive: true })
  const lineItems = unformatted.lineItems
    ? unformatted.lineItems.reduce((acc, i) => {
        if (i.itemType !== 'skus') return acc
        const { skuCode, ...rest } = i
        return [...acc, { ...rest, sku: skuCode }]
      }, [])
    : []
  return { ...unformatted, lineItems }
}

// CL api helpers
const Order = {
  create: attributes => async (relationships = {}) => {
    const cart = await client.post(`orders${orderIncludes}`, {
      data: { type: 'orders', attributes, relationships },
    }).catch(err => console.log(err))
    return formatOrder(cart)
  },
  read: async (id) => {
    const cart = await client.get(`orders/${id}${orderIncludes}`).catch(err => console.log(err))
    return formatOrder(cart)
  },
  update: id => async (attributes) => {
    const cart = await client.patch(`orders/${id}${orderIncludes}`, {
      data: {
        id,
        type: 'orders',
        attributes,
      },
    }).catch(err => console.log(err))
    return formatOrder(cart)
  },
}

const LineItem = {
  create: orderId => (attributes) => {
    return client.post('line_items', {
      data: {
        type: 'line_items',
        attributes,
        relationships: {
          order: {
            data: {
              type: 'orders',
              id: orderId,
            },
          },
        },
      },
    }).catch(err => console.log(err))
  },
  update: id => (attributes) => {
    return client.patch(`line_items/${id}`, {
      data: {
        id,
        type: 'line_items',
        attributes,
      },
    }).catch(err => console.log(err))
  },
  delete: id => client.delete(`line_items/${id}`).catch(err => console.log(err)),
  options: {
    create: ({ lineItemId, skuOptionId }) => (attributes) => {
      return client.post('line_item_options', {
        data: {
          type: 'line_item_options',
          attributes,
          relationships: {
            line_item: {
              data: {
                type: 'line_items',
                id: lineItemId,
              },
            },
            sku_option: {
              data: {
                type: 'sku_options',
                id: skuOptionId,
              },
            },
          },
        },
      }).catch(err => console.log(err))
    },
    update: id => (attributes) => {
      return client.patch(`line_item_options/${id}`, {
        data: {
          id,
          type: 'line_item_options',
          attributes,
        },
      }).catch(err => console.log(err))
    },
  },
}

const cart = {
  async fetch(id) {
    await setAuthentication()
    state.cart = await Order.read(id)

    return state.cart
  },
  async adjust (items) {
    await setAuthentication()
    const patchedLineItems = items.reduce((acc, { id, quantity }) => {
      return [...acc, LineItem.update(id)({ quantity })]
    }, [])
    await Promise.all(patchedLineItems)
    await this.fetch(state.cart.id)
    return state.cart
  },
  async remove(items) {
    await setAuthentication()
    const removals = items.map(id => LineItem.delete(id))
    await Promise.all(removals)
    await this.fetch(state.cart.id)
    return state.cart
  },
  async add(items) {
    await setAuthentication()
    const updated = state.cart.lineItems.reduce((acc, { id, sku, quantity }) => {
      const res = items.find(j => j.sku === sku)
      if (!res) return acc
      return [...acc, { id, sku, quantity: res.quantity + quantity }]
    }, [])

    if (updated.length) {
      const patchedLineItems = updated.map(({ id, quantity }) => LineItem.update(id)({ quantity }))
      await Promise.all(patchedLineItems)
    }

    if (updated.length !== items.length) {
      const filtered = items.filter(i => !updated.map(j => j.sku).includes(i.sku))
      const postLineItems = filtered.map(({ quantity, sku }) => LineItem.create(state.cart.id)({ quantity, sku_code: sku }))
      await Promise.all(postLineItems)
    }

    await this.fetch(state.cart.id)
    return state.cart
  },
}

// Authentication
const getToken = async () => {
  state.token = await CLayerAuth.getSalesChannelToken({
    clientId: state.config.clientId,
    endpoint: state.config.endpoint,
    scope: `market:${state.config.market}`,
  })

  return state.token
}

const setAuthentication = async () => {
  const now = Date.now()
  const tokenExpiry = state.token.expires.getTime()
  const tokenHasExpired = (tokenExpiry - now) < 60000

  if (!tokenHasExpired) return

  const token = await getToken()
  return token
}

const createCart = async () => {
  await setAuthentication()

  state.cart = await Order.create({
    // language_code: state.config.languageCode,
    // shipping_country_code_lock: state.config.shippingCode,
    metadata: {
      gift_box: false,
      preorder: false,
      comment: '',
    },
  })({
    market: {
      type: 'markets',
      id: state.config.market,
    },
  })

  setCookie(state.cartName)(state.cart.id)
  return state.cart
}

const init = async () => {
  state.config = {
    shippingCode: '<%= options.config.shippingCode %>',
    market: '<%= options.config.market %>',
    projectName: '<%= options.config.projectName %>',
    clientId: '<%= options.config.clientId %>',
    endpoint: '<%= options.config.endpoint %>',
    scope: '<%= options.config.scope %>',
  }

  await getToken()

  state.cartName = `${state.config.projectName}_cart_${state.config.market}_${state.config.shippingCode}`

  let cartId = getCookie(state.cartName)

  await setAuthentication()

  if (!cartId) {
    const newCart = await createCart()
    cartId = newCart.id
  }

  try {
    const gatheredCart = await cart.fetch(cartId)

    // If cart has been completed, remove and create new cart
    if (!['draft', 'pending'].includes(gatheredCart.status)) {
      removeCookie(state.cartName)

      await createCart()
    }
  } catch (error) {
    // If cart errors, remove and attempt to create new cart
    removeCookie(state.cartName)

    await createCart()
  }
  events.$emit('cart/init')
}

export default async (_, inject) => {
  if (process.client) init()
  await fetchProducts({
    productsApi: '<%= options.apis.products %>',
    priceListApi: '<%= options.apis.priceList %>',
    inventoryApi: '<%= options.apis.inventory %>',
  })
  inject('commerce', {
    cart,
    products,
    events,
  })
}
