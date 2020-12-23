import axios from 'axios'
import cookie from 'js-cookie'
import Vue from 'vue'

export const events = new Vue()

const state = {
  products: [],
}

// Cookies
export const getCookie = name => cookie.get(name)
export const setCookie = name => value => cookie.set(name, value, { expires: 14 })
export const removeCookie = name => cookie.remove(name)

export const fetchProducts = async ({ productsApi, priceListApi, inventoryApi }) => {
  const ep = [productsApi, priceListApi, inventoryApi]
  const promises = ep.map(url => axios.get(url))

  const data = await Promise.all(promises)

  const [productsData, priceListData, inventoryData] = data.map(d => d.data)
  const { warehouse, inventory } = inventoryData
  const { currencyCode, currencySymbol, priceList } = priceListData

  state.warehouse = warehouse
  state.currency = { currencyCode, currencySymbol }
  const mergedProducts = productsData.map((p) => {
    const variants = p.variants.map((v) => {
      const price = priceList.find(pl => pl.sku === v.sku)
      const stock = inventory.find(i => i.sku === v.sku)
      return { ...v, price, stock }
    })
    return { ...p, variants }
  })

  state.products = mergedProducts
}

export const products = {
  all: state.products,
  search(params) {
    const results = Object.keys(params).reduce((acc, key) =>
      [...acc, ...state.products.filter(p => p[key] === params[key])]
    , [])
    return results.length === 1 ? results[0] : results
  },
}
