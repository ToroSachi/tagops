/**
 * Shopify Custom Pixel (GTM integration for checkout)
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const shopifyCustomPixel: IntegrationTemplate = {
  id: "shopify-custom-pixel",
  version: "1.0.0",
  name: "Shopify Custom Pixel (GTM)",
  description:
    "Complete Shopify Custom Pixel: loads GTM container + subscribes to all checkout events (page_viewed, product_viewed, cart_viewed, checkout_started, checkout_completed, payment_info_submitted, collection_viewed, search_submitted)",
  vendor: "Shopify",
  category: "platform",
  requiredInputs: [
    {
      key: "pixelId",
      name: "GTM Container ID",
      description: "Your GTM Container ID (GTM-XXXXXXX)",
      example: "GTM-XXXXXXX",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const gtmIdLiteral = jsStringLiteral(inputs.pixelId);
    return [
      {
        name: "Shopify – GTM Custom Pixel (All Events)",
        type: "html",
        html: `<!-- Shopify Custom Pixel: Paste this into Settings > Customer events > Add custom pixel -->\n<script>\n// ── GTM Container Loader ──\n(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\nnew Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\nj=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n})(window,document,'script','dataLayer',${gtmIdLiteral});\n\n// ── Shopify Event Subscriptions ──\n// Each event pushes structured e-commerce data to GTM's dataLayer\n\n// Page View\nanalytics.subscribe('page_viewed', (event) => {\n  window.dataLayer.push({\n    event: 'page_viewed',\n    page_title: event.context.document.title,\n    page_location: event.context.document.location.href\n  });\n});\n\n// Product Viewed\nanalytics.subscribe('product_viewed', (event) => {\n  const p = event.data.productVariant;\n  window.dataLayer.push({\n    event: 'product_viewed',\n    ecommerce: {\n      currency: p.price.currencyCode,\n      value: parseFloat(p.price.amount),\n      items: [{\n        item_id: p.sku || p.id,\n        item_name: p.title,\n        item_variant: p.title,\n        price: parseFloat(p.price.amount),\n        quantity: 1\n      }]\n    }\n  });\n});\n\n// Collection Viewed\nanalytics.subscribe('collection_viewed', (event) => {\n  const c = event.data.collection;\n  window.dataLayer.push({\n    event: 'collection_viewed',\n    collection_id: c.id,\n    collection_title: c.title,\n    ecommerce: {\n      items: (c.productVariants || []).map((p, i) => ({\n        item_id: p.sku || p.id,\n        item_name: p.title,\n        price: parseFloat(p.price.amount),\n        index: i\n      }))\n    }\n  });\n});\n\n// Search Submitted\nanalytics.subscribe('search_submitted', (event) => {\n  window.dataLayer.push({\n    event: 'search_submitted',\n    search_term: event.data.searchResult.query\n  });\n});\n\n// Cart Viewed\nanalytics.subscribe('cart_viewed', (event) => {\n  const cart = event.data.cart;\n  window.dataLayer.push({\n    event: 'cart_viewed',\n    ecommerce: {\n      currency: cart.cost.totalAmount.currencyCode,\n      value: parseFloat(cart.cost.totalAmount.amount),\n      items: cart.lines.map((line, i) => ({\n        item_id: line.merchandise.sku || line.merchandise.id,\n        item_name: line.merchandise.title,\n        price: parseFloat(line.merchandise.price.amount),\n        quantity: line.quantity,\n        index: i\n      }))\n    }\n  });\n});\n\n// Checkout Started\nanalytics.subscribe('checkout_started', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'checkout_started',\n    ecommerce: {\n      currency: checkout.currencyCode,\n      value: parseFloat(checkout.totalPrice.amount),\n      items: checkout.lineItems.map((item, i) => ({\n        item_id: item.variant.sku || item.variant.id,\n        item_name: item.title,\n        item_variant: item.variant.title,\n        price: parseFloat(item.variant.price.amount),\n        quantity: item.quantity,\n        index: i\n      }))\n    }\n  });\n});\n\n// Payment Info Submitted\nanalytics.subscribe('payment_info_submitted', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'payment_info_submitted',\n    ecommerce: {\n      currency: checkout.currencyCode,\n      value: parseFloat(checkout.totalPrice.amount)\n    }\n  });\n});\n\n// Checkout Completed (Purchase)\nanalytics.subscribe('checkout_completed', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'checkout_completed',\n    ecommerce: {\n      transaction_id: checkout.order.id,\n      value: parseFloat(checkout.totalPrice.amount),\n      tax: parseFloat(checkout.totalTax.amount),\n      shipping: parseFloat(checkout.shippingLine.price.amount),\n      currency: checkout.currencyCode,\n      coupon: (checkout.discountApplications[0] || {}).title || '',\n      items: checkout.lineItems.map((item, i) => ({\n        item_id: item.variant.sku || item.variant.id,\n        item_name: item.title,\n        item_variant: item.variant.title,\n        price: parseFloat(item.variant.price.amount),\n        quantity: item.quantity,\n        index: i\n      }))\n    }\n  });\n});\n</script>`,
        triggerEvent: "all_pages",
        note: "Instruction-only template. Paste this code into Shopify Settings > Customer events > Add custom pixel. TagOps does not install Shopify custom pixels into GTM.",
        installMode: "instruction_only",
      },
    ];
  },
};
