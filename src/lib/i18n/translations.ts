/**
 * Static translation dictionary for the site's fixed UI chrome (nav,
 * buttons, cart, checkout, common messages) — never product names/titles
 * or brand names, which the owner explicitly wants left untranslated.
 * Product *descriptions* are translated separately, per-product, via
 * products.description_ja/description_ko (see server/products/queries.ts).
 *
 * Deliberately flat + hand-written rather than a full i18n library — the
 * UI surface this covers is small and fixed, so a typed object with one
 * entry per language is enough, and keeps every string reviewable in one
 * place instead of scattered across dozens of component-level lookups.
 */

export const SUPPORTED_LANGUAGES = ['en', 'ja', 'ko'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
}

/** Default language for a first-time visitor, keyed by geo-detected
 *  country — every other country (including PH) defaults to English by
 *  simply never showing the popup at all (see LanguageContext.tsx). */
export const COUNTRY_DEFAULT_LANGUAGE: Record<string, Language> = {
  SG: 'en',
  HK: 'en',
  MO: 'en',
  JP: 'ja',
  KR: 'ko',
}

export interface Translations {
  nav: {
    homeStore: string
    aboutUs: string
    reviews: string
    contactUs: string
  }
  header: {
    searchAriaLabel: string
    accountAriaLabel: string
    cartAriaLabel: string
    openMenu: string
    closeMenu: string
  }
  footer: {
    shopHeading: string
    allProducts: string
    collections: string
    cart: string
    helpHeading: string
    account: string
    shippingAndReturns: string
    contactUs: string
    stayUpdatedHeading: string
    stayUpdatedBody: string
    emailPlaceholder: string
    join: string
    rightsReserved: string
  }
  countrySelect: {
    searchCountry: string
    selectCountry: string
    noCountriesFound: string
  }
  addedToCart: {
    itemAdded: string
    viewMyCart: (count: number) => string
    checkOut: string
    continueShopping: string
  }
  freeShipping: {
    addMoreAmount: (amount: string) => string
    addMoreItems: (count: number) => string
  }
  cart: {
    title: string
    loading: string
    empty: string
    continueShopping: string
    remove: string
    discountCodePlaceholder: string
    apply: string
    applying: string
    applied: (codeOrTitle: string) => string
    freeShippingLabel: string
    subtotal: string
    discount: string
    total: string
    checkout: string
  }
  checkout: {
    title: string
    contact: string
    email: string
    delivery: string
    country: string
    recipientName: string
    phone: string
    city: string
    stateProvince: string
    addressLine1: string
    addressLine1Placeholder: string
    addressLine2Optional: string
    landmarkOptional: string
    postalCode: string
    shippingMethod: string
    selectRegionPrompt: string
    standardShipping: string
    free: string
    continueToPayment: string
    enterDeliveryRegion: string
  }
  payment: {
    title: string
    deliverTo: string
    edit: string
    paymentMethod: string
    cod: string
    payOnline: string
    pricesShownIn: (currency: string) => string
    subtotal: string
    discount: string
    shipping: string
    total: string
    redirecting: string
    placingOrder: string
    continueToPay: (amount: string) => string
    placeOrder: (amount: string) => string
    missingDeliveryTitle: string
    missingDeliveryBody: string
    backToCheckout: string
    paymentFailedError: string
  }
  confirmation: {
    orderPlaced: string
    order: string
    thanksMessage: string
    continueShopping: string
    confirmingPayment: string
    stillConfirmingPayment: string
  }
  product: {
    size: string
    color: string
    style: string
    outOfStock: string
    selectOptions: string
    adding: string
    addToCart: string
  }
  languagePopup: {
    title: string
    body: string
    continueButton: string
  }
  collections: {
    pageTitle: string
    allCollections: string
    viewAll: string
    noProductsYet: string
    noProductsInCollection: string
    graphicTees: string
    muscleTees: string
    poloShirts: string
    hoodiesJackets: string
    meshShorts: string
    jorts: string
    bottoms: string
    jerseyTee: string
    essentials: string
    blanks: string
  }
}

export const translations: Record<Language, Translations> = {
  en: {
    nav: {
      homeStore: 'Home Store',
      aboutUs: 'About Us',
      reviews: 'Reviews',
      contactUs: 'Contact Us',
    },
    header: {
      searchAriaLabel: 'Search products',
      accountAriaLabel: 'Account',
      cartAriaLabel: 'Cart',
      openMenu: 'Open menu',
      closeMenu: 'Close menu',
    },
    footer: {
      shopHeading: 'Shop',
      allProducts: 'All Products',
      collections: 'Collections',
      cart: 'Cart',
      helpHeading: 'Help',
      account: 'Account',
      shippingAndReturns: 'Shipping & Returns',
      contactUs: 'Contact Us',
      stayUpdatedHeading: 'Stay Updated',
      stayUpdatedBody: 'Get first access to new drops and restocks.',
      emailPlaceholder: 'Email address',
      join: 'Join',
      rightsReserved: 'All rights reserved.',
    },
    countrySelect: {
      searchCountry: 'Search country',
      selectCountry: 'Select country',
      noCountriesFound: 'No countries found',
    },
    addedToCart: {
      itemAdded: 'Item added to your cart',
      viewMyCart: (count) => `View my cart (${count})`,
      checkOut: 'Check out',
      continueShopping: 'Continue shopping',
    },
    freeShipping: {
      addMoreAmount: (amount) => `Add ${amount} more to unlock free shipping`,
      addMoreItems: (count) =>
        `Add ${count} more item${count === 1 ? '' : 's'} to unlock free shipping`,
    },
    cart: {
      title: 'Your Cart',
      loading: 'Loading cart...',
      empty: 'Your cart is empty',
      continueShopping: 'Continue shopping',
      remove: 'Remove',
      discountCodePlaceholder: 'Discount code',
      apply: 'Apply',
      applying: 'Applying...',
      applied: (codeOrTitle) => `${codeOrTitle} applied`,
      freeShippingLabel: 'Free shipping',
      subtotal: 'Subtotal',
      discount: 'Discount',
      total: 'Total',
      checkout: 'Checkout',
    },
    checkout: {
      title: 'Checkout',
      contact: 'Contact',
      email: 'Email',
      delivery: 'Delivery',
      country: 'Country',
      recipientName: 'Recipient name',
      phone: 'Phone',
      city: 'City',
      stateProvince: 'State / Province',
      addressLine1: 'Address line 1',
      addressLine1Placeholder: 'House/unit no., street',
      addressLine2Optional: 'Address line 2 (optional)',
      landmarkOptional: 'Landmark (optional)',
      postalCode: 'Postal code',
      shippingMethod: 'Shipping method',
      selectRegionPrompt: 'Select a region above to see shipping options.',
      standardShipping: 'Standard shipping',
      free: 'Free',
      continueToPayment: 'Continue to payment',
      enterDeliveryRegion: 'Enter delivery region',
    },
    payment: {
      title: 'Payment',
      deliverTo: 'Deliver to',
      edit: 'Edit',
      paymentMethod: 'Payment method',
      cod: 'Cash on Delivery (COD)',
      payOnline: 'Pay Online — GCash, Maya, Cards, Bank Transfer',
      pricesShownIn: (currency) =>
        `Prices are shown in ${currency} for reference — you'll be charged the PHP equivalent`,
      subtotal: 'Subtotal',
      discount: 'Discount',
      shipping: 'Shipping',
      total: 'Total',
      redirecting: 'Redirecting to payment...',
      placingOrder: 'Placing order...',
      continueToPay: (amount) => `Continue to pay — ${amount}`,
      placeOrder: (amount) => `Place order — ${amount}`,
      missingDeliveryTitle: 'Missing delivery details',
      missingDeliveryBody: 'Please fill in your contact and delivery information first.',
      backToCheckout: 'Back to checkout',
      paymentFailedError:
        'Your online payment didn’t go through. You can try again or choose Cash on Delivery instead.',
    },
    confirmation: {
      orderPlaced: 'Order placed!',
      order: 'Order',
      thanksMessage:
        "Thanks for your order — we'll text and email you updates as it's packed and shipped.",
      continueShopping: 'Continue shopping',
      confirmingPayment: 'Confirming your payment…',
      stillConfirmingPayment:
        "Still confirming your payment — this is taking longer than usual. We'll email you as soon as it's confirmed.",
    },
    product: {
      size: 'size',
      color: 'color',
      style: 'style',
      outOfStock: 'Out of stock',
      selectOptions: 'Select options',
      adding: 'Adding...',
      addToCart: 'Add to Cart',
    },
    languagePopup: {
      title: 'Choose your language',
      body: 'Select the language you’d like to browse the site in.',
      continueButton: 'Continue',
    },
    collections: {
      pageTitle: 'Collections',
      allCollections: 'All Collections',
      viewAll: 'View all',
      noProductsYet: 'No products yet.',
      noProductsInCollection: 'No products in this collection yet.',
      graphicTees: 'Graphic Tees',
      muscleTees: 'Muscle Tees',
      poloShirts: 'Polo Shirts',
      hoodiesJackets: 'Hoodies & Jackets',
      meshShorts: 'Mesh Shorts',
      jorts: 'Jorts',
      bottoms: 'Bottoms',
      jerseyTee: 'Jersey Tee',
      essentials: 'Essentials',
      blanks: 'Blanks',
    },
  },
  ja: {
    nav: {
      homeStore: 'ホーム',
      aboutUs: '私たちについて',
      reviews: 'レビュー',
      contactUs: 'お問い合わせ',
    },
    header: {
      searchAriaLabel: '商品を検索',
      accountAriaLabel: 'アカウント',
      cartAriaLabel: 'カート',
      openMenu: 'メニューを開く',
      closeMenu: 'メニューを閉じる',
    },
    footer: {
      shopHeading: 'ショップ',
      allProducts: 'すべての商品',
      collections: 'コレクション',
      cart: 'カート',
      helpHeading: 'ヘルプ',
      account: 'アカウント',
      shippingAndReturns: '配送・返品について',
      contactUs: 'お問い合わせ',
      stayUpdatedHeading: '最新情報',
      stayUpdatedBody: '新商品や再入荷情報をいち早くお届けします。',
      emailPlaceholder: 'メールアドレス',
      join: '登録する',
      rightsReserved: 'All rights reserved.',
    },
    countrySelect: {
      searchCountry: '国を検索',
      selectCountry: '国を選択',
      noCountriesFound: '該当する国がありません',
    },
    addedToCart: {
      itemAdded: '商品をカートに追加しました',
      viewMyCart: (count) => `カートを見る (${count})`,
      checkOut: 'レジに進む',
      continueShopping: '買い物を続ける',
    },
    freeShipping: {
      addMoreAmount: (amount) => `あと${amount}で送料無料`,
      addMoreItems: (count) => `あと${count}点で送料無料`,
    },
    cart: {
      title: 'カート',
      loading: 'カートを読み込み中...',
      empty: 'カートは空です',
      continueShopping: '買い物を続ける',
      remove: '削除',
      discountCodePlaceholder: '割引コード',
      apply: '適用',
      applying: '適用中...',
      applied: (codeOrTitle) => `${codeOrTitle} を適用しました`,
      freeShippingLabel: '送料無料',
      subtotal: '小計',
      discount: '割引',
      total: '合計',
      checkout: 'レジに進む',
    },
    checkout: {
      title: 'レジに進む',
      contact: '連絡先',
      email: 'メールアドレス',
      delivery: 'お届け先',
      country: '国',
      recipientName: 'お名前',
      phone: '電話番号',
      city: '市区町村',
      stateProvince: '都道府県',
      addressLine1: '住所1',
      addressLine1Placeholder: '番地・建物名',
      addressLine2Optional: '住所2（任意）',
      landmarkOptional: '目印（任意）',
      postalCode: '郵便番号',
      shippingMethod: '配送方法',
      selectRegionPrompt: '上記で地域を選択すると配送方法が表示されます。',
      standardShipping: '通常配送',
      free: '無料',
      continueToPayment: 'お支払いへ進む',
      enterDeliveryRegion: '配送地域を入力してください',
    },
    payment: {
      title: 'お支払い',
      deliverTo: 'お届け先',
      edit: '編集',
      paymentMethod: 'お支払い方法',
      cod: '代金引換 (COD)',
      payOnline: 'オンライン決済 — GCash、Maya、カード、銀行振込',
      pricesShownIn: (currency) =>
        `参考として${currency}で表示しています — 実際にはPHP相当額が請求されます`,
      subtotal: '小計',
      discount: '割引',
      shipping: '送料',
      total: '合計',
      redirecting: '決済ページに移動しています...',
      placingOrder: '注文を確定しています...',
      continueToPay: (amount) => `支払いに進む — ${amount}`,
      placeOrder: (amount) => `注文を確定する — ${amount}`,
      missingDeliveryTitle: 'お届け先情報が未入力です',
      missingDeliveryBody: 'まず連絡先とお届け先情報を入力してください。',
      backToCheckout: 'レジに戻る',
      paymentFailedError:
        'オンライン決済が完了しませんでした。もう一度お試しいただくか、代金引換をご利用ください。',
    },
    confirmation: {
      orderPlaced: 'ご注文ありがとうございます！',
      order: '注文番号',
      thanksMessage:
        'ご注文ありがとうございます。梱包・発送時にSMSとメールでお知らせします。',
      continueShopping: '買い物を続ける',
      confirmingPayment: 'お支払いを確認しています…',
      stillConfirmingPayment:
        'お支払いの確認に通常より時間がかかっています。確認が取れ次第メールでお知らせします。',
    },
    product: {
      size: 'サイズ',
      color: 'カラー',
      style: 'スタイル',
      outOfStock: '在庫切れ',
      selectOptions: 'オプションを選択',
      adding: '追加中...',
      addToCart: 'カートに追加',
    },
    languagePopup: {
      title: '言語を選択してください',
      body: 'サイトを表示する言語を選択してください。',
      continueButton: '続ける',
    },
    collections: {
      pageTitle: 'コレクション',
      allCollections: 'すべてのコレクション',
      viewAll: 'すべて見る',
      noProductsYet: '商品はまだありません。',
      noProductsInCollection: 'このコレクションにはまだ商品がありません。',
      graphicTees: 'グラフィックTシャツ',
      muscleTees: 'マッスルTシャツ',
      poloShirts: 'ポロシャツ',
      hoodiesJackets: 'フーディー＆ジャケット',
      meshShorts: 'メッシュショーツ',
      jorts: 'ジョーツ',
      bottoms: 'ボトムス',
      jerseyTee: 'ジャージーTシャツ',
      essentials: 'エッセンシャルズ',
      blanks: '無地アイテム',
    },
  },
  ko: {
    nav: {
      homeStore: '홈',
      aboutUs: '소개',
      reviews: '리뷰',
      contactUs: '문의하기',
    },
    header: {
      searchAriaLabel: '상품 검색',
      accountAriaLabel: '계정',
      cartAriaLabel: '장바구니',
      openMenu: '메뉴 열기',
      closeMenu: '메뉴 닫기',
    },
    footer: {
      shopHeading: '쇼핑',
      allProducts: '전체 상품',
      collections: '컬렉션',
      cart: '장바구니',
      helpHeading: '고객센터',
      account: '계정',
      shippingAndReturns: '배송 및 반품 안내',
      contactUs: '문의하기',
      stayUpdatedHeading: '소식 받기',
      stayUpdatedBody: '신상품과 재입고 소식을 가장 먼저 받아보세요.',
      emailPlaceholder: '이메일 주소',
      join: '구독하기',
      rightsReserved: 'All rights reserved.',
    },
    countrySelect: {
      searchCountry: '국가 검색',
      selectCountry: '국가 선택',
      noCountriesFound: '검색 결과가 없습니다',
    },
    addedToCart: {
      itemAdded: '상품이 장바구니에 담겼습니다',
      viewMyCart: (count) => `장바구니 보기 (${count})`,
      checkOut: '결제하기',
      continueShopping: '쇼핑 계속하기',
    },
    freeShipping: {
      addMoreAmount: (amount) => `${amount} 더 담으면 무료 배송`,
      addMoreItems: (count) => `${count}개 더 담으면 무료 배송`,
    },
    cart: {
      title: '장바구니',
      loading: '장바구니를 불러오는 중...',
      empty: '장바구니가 비어 있습니다',
      continueShopping: '쇼핑 계속하기',
      remove: '삭제',
      discountCodePlaceholder: '할인 코드',
      apply: '적용',
      applying: '적용 중...',
      applied: (codeOrTitle) => `${codeOrTitle} 적용됨`,
      freeShippingLabel: '무료 배송',
      subtotal: '소계',
      discount: '할인',
      total: '합계',
      checkout: '결제하기',
    },
    checkout: {
      title: '결제하기',
      contact: '연락처',
      email: '이메일',
      delivery: '배송지',
      country: '국가',
      recipientName: '받는 사람',
      phone: '전화번호',
      city: '도시',
      stateProvince: '주 / 도',
      addressLine1: '주소 1',
      addressLine1Placeholder: '건물/호수, 도로명',
      addressLine2Optional: '주소 2 (선택)',
      landmarkOptional: '주변 건물 (선택)',
      postalCode: '우편번호',
      shippingMethod: '배송 방법',
      selectRegionPrompt: '위에서 지역을 선택하면 배송 옵션이 표시됩니다.',
      standardShipping: '기본 배송',
      free: '무료',
      continueToPayment: '결제로 계속하기',
      enterDeliveryRegion: '배송 지역을 입력하세요',
    },
    payment: {
      title: '결제',
      deliverTo: '배송지',
      edit: '수정',
      paymentMethod: '결제 방법',
      cod: '착불 (COD)',
      payOnline: '온라인 결제 — GCash, Maya, 카드, 계좌이체',
      pricesShownIn: (currency) =>
        `참고용으로 ${currency}로 표시되며, 실제로는 PHP 상당액이 청구됩니다`,
      subtotal: '소계',
      discount: '할인',
      shipping: '배송비',
      total: '합계',
      redirecting: '결제 페이지로 이동 중...',
      placingOrder: '주문을 처리하고 있습니다...',
      continueToPay: (amount) => `결제 계속하기 — ${amount}`,
      placeOrder: (amount) => `주문하기 — ${amount}`,
      missingDeliveryTitle: '배송 정보가 없습니다',
      missingDeliveryBody: '먼저 연락처와 배송 정보를 입력해 주세요.',
      backToCheckout: '결제 페이지로 돌아가기',
      paymentFailedError:
        '온라인 결제가 완료되지 않았습니다. 다시 시도하거나 착불(COD)을 선택해 주세요.',
    },
    confirmation: {
      orderPlaced: '주문이 완료되었습니다!',
      order: '주문번호',
      thanksMessage:
        '주문해 주셔서 감사합니다 — 포장 및 발송 시 문자와 이메일로 안내해 드립니다.',
      continueShopping: '쇼핑 계속하기',
      confirmingPayment: '결제를 확인하는 중입니다…',
      stillConfirmingPayment:
        '결제 확인이 평소보다 오래 걸리고 있습니다. 확인되는 대로 이메일로 안내해 드리겠습니다.',
    },
    product: {
      size: '사이즈',
      color: '색상',
      style: '스타일',
      outOfStock: '품절',
      selectOptions: '옵션을 선택하세요',
      adding: '담는 중...',
      addToCart: '장바구니에 담기',
    },
    languagePopup: {
      title: '언어를 선택하세요',
      body: '사이트를 이용할 언어를 선택해 주세요.',
      continueButton: '계속하기',
    },
    collections: {
      pageTitle: '컬렉션',
      allCollections: '모든 컬렉션',
      viewAll: '전체 보기',
      noProductsYet: '아직 상품이 없습니다.',
      noProductsInCollection: '이 컬렉션에는 아직 상품이 없습니다.',
      graphicTees: '그래픽 티셔츠',
      muscleTees: '머슬 티셔츠',
      poloShirts: '폴로 셔츠',
      hoodiesJackets: '후디 & 재킷',
      meshShorts: '메쉬 쇼츠',
      jorts: '조트',
      bottoms: '하의',
      jerseyTee: '저지 티셔츠',
      essentials: '에센셜',
      blanks: '무지 아이템',
    },
  },
}
