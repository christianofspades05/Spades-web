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
    /** Shown per cart line when a discount only covers some of that line's
     *  units (see discounts.max_discounted_items) — e.g. "Discount applies
     *  to 2 of 4". */
    discountAppliesTo: (discounted: number, total: number) => string
    /** Shown under the applied-discount banner when a code is stacked on
     *  top of an active store-wide sale — e.g. "+ Summer Sale". */
    stackedWithSale: (saleTitle: string) => string
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
  reviews: {
    feedbackHeading: string
    feedbackThanks: string
    name: string
    email: string
    phoneNumber: string
    comment: string
    sending: string
    send: string
    customersHeading: string
    fromReviews: (count: number) => string
    noReviewsYet: string
    verifiedBuyer: string
    goToReviewPage: (page: number) => string
  }
  contact: {
    body: string
  }
  account: {
    yourAccount: string
    logOut: string
    orderHistory: string
    noOrdersYet: string
    orderColumn: string
    itemsColumn: string
    trackingNumberColumn: string
    trackingColumn: string
    paymentColumn: string
    unfulfilled: string
    trackPackage: string
    noTracking: string
    savedAddresses: string
    addAddress: string
    noSavedAddresses: string
    cancelOrder: string
    writeReview: string
    cancelOrderTitle: string
    cancelOrderBody: string
    cancelReasonPlaceholder: string
    cancelReasonRequired: string
    neverMind: string
    confirmCancellation: string
    cancelling: string
    noAccountHeading: string
    noAccountBody: string
    createAccount: string
    signIn: string
    alreadyHaveAccount: string
    or: string
    password: string
    signingIn: string
    continueWithGoogle: string
    alreadyHaveOne: string
    dateOfBirth: string
    dobImmutable: string
    creatingAccount: string
    signUpWithGoogle: string
    checkYourEmail: string
    codeSentPrefix: string
    codeSentSuffix: string
    verificationCode: string
    verifying: string
    verify: string
    resendCode: string
    resendCodeWithTimer: (seconds: number) => string
    codeResent: string
    forgotPassword: string
    forgotPasswordHeading: string
    forgotPasswordBody: string
    sendResetLink: string
    sendingResetLink: string
    resetLinkSentBody: string
    backToLogin: string
    setNewPasswordHeading: string
    setNewPasswordBody: string
    newPassword: string
    confirmNewPassword: string
    passwordsDontMatch: string
    updatingPassword: string
    updatePassword: string
    resetLinkExpired: string
    thanksForReview: string
    reviewAppreciation: string
    backToAccount: string
    allDone: string
    alreadyReviewed: (orderNumber: string) => string
    howWasIt: string
    rateReviewBody: (orderNumber: string) => string
    reviewPlaceholder: string
    photoTooLarge: string
    ratingRequired: string
    submitting: string
    submitReview: string
    labelOptional: string
    labelPlaceholder: string
    postalCodeOptional: string
    defaultShipping: string
    defaultBilling: string
    saveAddress: string
    cancel: string
    saving: string
    hidePassword: string
    showPassword: string
  }
  emailCapture: {
    title: string
    body: string
    emailPlaceholder: string
    getCode: string
    sending: string
    alreadyCustomer: string
    successMessage: string
    alreadyCustomerMessage: string
    closeAriaLabel: string
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
      discountAppliesTo: (discounted, total) =>
        `Discount applies to ${discounted} of ${total}`,
      stackedWithSale: (saleTitle) => `+ ${saleTitle}`,
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
    reviews: {
      feedbackHeading:
        'Have any recommendations? Help us improve with your insights',
      feedbackThanks: 'Thanks — we appreciate the feedback!',
      name: 'Name',
      email: 'Email *',
      phoneNumber: 'Phone number',
      comment: 'Comment',
      sending: 'Sending…',
      send: 'Send',
      customersHeading: 'Let customers speak for us',
      fromReviews: (count) =>
        `from ${count} review${count === 1 ? '' : 's'}`,
      noReviewsYet:
        'No reviews yet — be the first to leave one after your order arrives.',
      verifiedBuyer: 'Verified buyer',
      goToReviewPage: (page) => `Go to review page ${page}`,
    },
    contact: {
      body: 'Find us and reach out on our social channels.',
    },
    account: {
      yourAccount: 'Your account',
      logOut: 'Log out',
      orderHistory: 'Order history',
      noOrdersYet: "You haven't placed any orders yet.",
      orderColumn: 'Order',
      itemsColumn: 'Items',
      trackingNumberColumn: 'Tracking number',
      trackingColumn: 'Tracking',
      paymentColumn: 'Payment',
      unfulfilled: 'Unfulfilled',
      trackPackage: 'Track package',
      noTracking: 'No tracking',
      savedAddresses: 'Saved addresses',
      addAddress: '+ Add address',
      noSavedAddresses: 'No saved addresses yet.',
      cancelOrder: 'Cancel order',
      writeReview: 'Write a review',
      cancelOrderTitle: 'Cancel this order?',
      cancelOrderBody: 'Let us know why — this helps us follow up if needed.',
      cancelReasonPlaceholder:
        'e.g. Ordered by mistake, found it cheaper elsewhere…',
      cancelReasonRequired:
        'Please tell us why you want to cancel this order.',
      neverMind: 'Never mind',
      confirmCancellation: 'Confirm cancellation',
      cancelling: 'Cancelling…',
      noAccountHeading: "Don't have an account?",
      noAccountBody:
        'Create one to track your orders, save your addresses, and check out faster next time.',
      createAccount: 'Create an account',
      signIn: 'Sign in',
      alreadyHaveAccount: 'Already have an account? Sign in below.',
      or: 'OR',
      password: 'Password',
      signingIn: 'Signing in…',
      continueWithGoogle: 'Continue with Google',
      alreadyHaveOne: 'Already have one?',
      dateOfBirth: 'Date of birth',
      dobImmutable: "Can't be changed once your account is created.",
      creatingAccount: 'Creating account…',
      signUpWithGoogle: 'Sign up with Google',
      checkYourEmail: 'Check your email',
      codeSentPrefix: 'We sent an 8-digit code to',
      codeSentSuffix: 'Enter it below to verify your account.',
      verificationCode: 'Verification code',
      verifying: 'Verifying…',
      verify: 'Verify',
      resendCode: 'Resend code',
      resendCodeWithTimer: (seconds) => `Resend code (${seconds}s)`,
      codeResent: 'A new code has been sent.',
      forgotPassword: 'Forgot password?',
      forgotPasswordHeading: 'Reset your password',
      forgotPasswordBody:
        "Enter your email and we'll send you a link to reset your password.",
      sendResetLink: 'Send reset link',
      sendingResetLink: 'Sending…',
      resetLinkSentBody:
        "If an account exists for that email, we've sent a link to reset your password.",
      backToLogin: 'Back to sign in',
      setNewPasswordHeading: 'Set a new password',
      setNewPasswordBody: 'Choose a new password for your account.',
      newPassword: 'New password',
      confirmNewPassword: 'Confirm new password',
      passwordsDontMatch: "Passwords don't match",
      updatingPassword: 'Updating…',
      updatePassword: 'Update password',
      resetLinkExpired:
        'This reset link is invalid or has expired. Request a new one.',
      thanksForReview: 'Thanks for your review!',
      reviewAppreciation:
        "We appreciate you taking the time — it'll appear on the product page once it's been checked.",
      backToAccount: 'Back to your account',
      allDone: 'All done!',
      alreadyReviewed: (orderNumber) =>
        `You've already reviewed everything from order ${orderNumber}. Thank you!`,
      howWasIt: 'How was it?',
      rateReviewBody: (orderNumber) =>
        `Rate and review the items from order ${orderNumber}. Only products you rate will be submitted.`,
      reviewPlaceholder: 'Tell us what you think (optional)',
      photoTooLarge: 'Photo must be smaller than 8MB.',
      ratingRequired: 'Please rate at least one product before submitting.',
      submitting: 'Submitting…',
      submitReview: 'Submit review',
      labelOptional: 'Label (optional)',
      labelPlaceholder: 'Home, Office…',
      postalCodeOptional: 'Postal code (optional)',
      defaultShipping: 'Default shipping address',
      defaultBilling: 'Default billing address',
      saveAddress: 'Save address',
      cancel: 'Cancel',
      saving: 'Saving…',
      hidePassword: 'Hide password',
      showPassword: 'Show password',
    },
    emailCapture: {
      title: '10% off for 1st time customer',
      body: 'Enter your email and we’ll send you a one-time code — valid for 24 hours.',
      emailPlaceholder: 'Email address',
      getCode: 'Get code',
      sending: 'Sending…',
      alreadyCustomer: 'Already a customer',
      successMessage: 'Check your inbox — your code is on its way!',
      alreadyCustomerMessage:
        'Looks like you’re already one of us! No new code this time, but thanks for stopping by.',
      closeAriaLabel: 'Close',
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
      discountAppliesTo: (discounted, total) =>
        `割引は${total}点中${discounted}点に適用されます`,
      stackedWithSale: (saleTitle) => `+ ${saleTitle}`,
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
    reviews: {
      feedbackHeading:
        'ご意見・ご要望はありますか？あなたの声で私たちをより良くしてください',
      feedbackThanks: 'ありがとうございます — ご意見をお寄せいただき感謝いたします！',
      name: 'お名前',
      email: 'メールアドレス *',
      phoneNumber: '電話番号',
      comment: 'コメント',
      sending: '送信中…',
      send: '送信',
      customersHeading: 'お客様の声',
      fromReviews: (count) => `${count}件のレビューより`,
      noReviewsYet:
        'まだレビューはありません — ご注文到着後、最初のレビューを投稿してみませんか。',
      verifiedBuyer: '購入確認済み',
      goToReviewPage: (page) => `レビューページ${page}へ移動`,
    },
    contact: {
      body: 'SNSで私たちを見つけて、お気軽にご連絡ください。',
    },
    account: {
      yourAccount: 'マイアカウント',
      logOut: 'ログアウト',
      orderHistory: '注文履歴',
      noOrdersYet: 'まだご注文がありません。',
      orderColumn: '注文',
      itemsColumn: '商品',
      trackingNumberColumn: '追跡番号',
      trackingColumn: '追跡',
      paymentColumn: 'お支払い',
      unfulfilled: '未発送',
      trackPackage: '荷物を追跡',
      noTracking: '追跡情報なし',
      savedAddresses: '保存済みの住所',
      addAddress: '+ 住所を追加',
      noSavedAddresses: '保存された住所はまだありません。',
      cancelOrder: '注文をキャンセル',
      writeReview: 'レビューを書く',
      cancelOrderTitle: 'この注文をキャンセルしますか？',
      cancelOrderBody:
        '理由を教えてください — 必要に応じてフォローアップに役立ちます。',
      cancelReasonPlaceholder: '例：誤って注文した、他でもっと安く見つけた…',
      cancelReasonRequired: 'この注文をキャンセルする理由を教えてください。',
      neverMind: 'やめておく',
      confirmCancellation: 'キャンセルを確定',
      cancelling: 'キャンセル中…',
      noAccountHeading: 'アカウントをお持ちでないですか？',
      noAccountBody:
        'アカウントを作成すると、注文の追跡、住所の保存、次回からのスムーズなチェックアウトができます。',
      createAccount: 'アカウントを作成',
      signIn: 'ログイン',
      alreadyHaveAccount:
        'すでにアカウントをお持ちですか？以下からログインしてください。',
      or: 'または',
      password: 'パスワード',
      signingIn: 'ログイン中…',
      continueWithGoogle: 'Googleで続ける',
      alreadyHaveOne: 'すでにお持ちですか？',
      dateOfBirth: '生年月日',
      dobImmutable: 'アカウント作成後は変更できません。',
      creatingAccount: 'アカウント作成中…',
      signUpWithGoogle: 'Googleで登録',
      checkYourEmail: 'メールをご確認ください',
      codeSentPrefix: '8桁のコードを送信しました：',
      codeSentSuffix: '下に入力してアカウントを認証してください。',
      verificationCode: '認証コード',
      verifying: '認証中…',
      verify: '認証する',
      resendCode: 'コードを再送信',
      resendCodeWithTimer: (seconds) => `コードを再送信（${seconds}秒）`,
      codeResent: '新しいコードを送信しました。',
      forgotPassword: 'パスワードをお忘れですか？',
      forgotPasswordHeading: 'パスワードを再設定',
      forgotPasswordBody:
        'メールアドレスを入力すると、パスワード再設定用のリンクをお送りします。',
      sendResetLink: 'リセットリンクを送信',
      sendingResetLink: '送信中…',
      resetLinkSentBody:
        'ご入力のメールアドレスのアカウントが存在する場合、パスワード再設定用のリンクをお送りしました。',
      backToLogin: 'ログインに戻る',
      setNewPasswordHeading: '新しいパスワードを設定',
      setNewPasswordBody: 'アカウントの新しいパスワードを設定してください。',
      newPassword: '新しいパスワード',
      confirmNewPassword: '新しいパスワード（確認）',
      passwordsDontMatch: 'パスワードが一致しません',
      updatingPassword: '更新中…',
      updatePassword: 'パスワードを更新',
      resetLinkExpired:
        'このリセットリンクは無効か期限切れです。もう一度リクエストしてください。',
      thanksForReview: 'レビューありがとうございます！',
      reviewAppreciation:
        'お時間をいただきありがとうございます — 確認後、商品ページに表示されます。',
      backToAccount: 'アカウントに戻る',
      allDone: '完了しました！',
      alreadyReviewed: (orderNumber) =>
        `注文${orderNumber}の商品はすべてレビュー済みです。ありがとうございました！`,
      howWasIt: 'いかがでしたか？',
      rateReviewBody: (orderNumber) =>
        `注文${orderNumber}の商品を評価・レビューしてください。評価した商品のみ送信されます。`,
      reviewPlaceholder: 'ご感想をお聞かせください（任意）',
      photoTooLarge: '写真は8MB以下にしてください。',
      ratingRequired: '送信する前に、少なくとも1つの商品を評価してください。',
      submitting: '送信中…',
      submitReview: 'レビューを送信',
      labelOptional: 'ラベル（任意）',
      labelPlaceholder: '自宅、オフィスなど…',
      postalCodeOptional: '郵便番号（任意）',
      defaultShipping: 'デフォルトの配送先住所',
      defaultBilling: 'デフォルトの請求先住所',
      saveAddress: '住所を保存',
      cancel: 'キャンセル',
      saving: '保存中…',
      hidePassword: 'パスワードを隠す',
      showPassword: 'パスワードを表示',
    },
    emailCapture: {
      title: '初回限定10%OFF',
      body: 'メールアドレスを入力すると、24時間限定の割引コードをお送りします。',
      emailPlaceholder: 'メールアドレス',
      getCode: 'コードを受け取る',
      sending: '送信中…',
      alreadyCustomer: 'すでに会員です',
      successMessage: 'メールをご確認ください — コードをお送りしました！',
      alreadyCustomerMessage:
        'すでにご登録済みのようです。今回は新しいコードはございませんが、お立ち寄りいただきありがとうございます。',
      closeAriaLabel: '閉じる',
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
      discountAppliesTo: (discounted, total) =>
        `할인은 ${total}개 중 ${discounted}개에 적용됩니다`,
      stackedWithSale: (saleTitle) => `+ ${saleTitle}`,
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
    reviews: {
      feedbackHeading: '추천하고 싶은 점이 있으신가요? 소중한 의견으로 저희를 발전시켜 주세요',
      feedbackThanks: '감사합니다 — 소중한 의견 감사드립니다!',
      name: '이름',
      email: '이메일 *',
      phoneNumber: '전화번호',
      comment: '의견',
      sending: '전송 중…',
      send: '보내기',
      customersHeading: '고객들의 후기',
      fromReviews: (count) => `리뷰 ${count}개 기준`,
      noReviewsYet: '아직 리뷰가 없습니다 — 주문하신 상품이 도착하면 첫 번째 리뷰를 남겨보세요.',
      verifiedBuyer: '구매 확인됨',
      goToReviewPage: (page) => `리뷰 페이지 ${page}로 이동`,
    },
    contact: {
      body: 'SNS에서 저희를 찾아보시고 편하게 연락해 주세요.',
    },
    account: {
      yourAccount: '내 계정',
      logOut: '로그아웃',
      orderHistory: '주문 내역',
      noOrdersYet: '아직 주문한 내역이 없습니다.',
      orderColumn: '주문',
      itemsColumn: '상품',
      trackingNumberColumn: '운송장 번호',
      trackingColumn: '배송 조회',
      paymentColumn: '결제',
      unfulfilled: '미발송',
      trackPackage: '배송 조회',
      noTracking: '배송 조회 정보 없음',
      savedAddresses: '저장된 주소',
      addAddress: '+ 주소 추가',
      noSavedAddresses: '저장된 주소가 아직 없습니다.',
      cancelOrder: '주문 취소',
      writeReview: '리뷰 작성',
      cancelOrderTitle: '이 주문을 취소하시겠어요?',
      cancelOrderBody:
        '이유를 알려주세요 — 필요할 경우 후속 조치에 도움이 됩니다.',
      cancelReasonPlaceholder: '예: 실수로 주문함, 다른 곳에서 더 저렴하게 발견함…',
      cancelReasonRequired: '이 주문을 취소하려는 이유를 알려주세요.',
      neverMind: '취소하지 않기',
      confirmCancellation: '취소 확정',
      cancelling: '취소하는 중…',
      noAccountHeading: '계정이 없으신가요?',
      noAccountBody:
        '계정을 만들면 주문을 추적하고, 주소를 저장하고, 다음번에 더 빠르게 결제할 수 있습니다.',
      createAccount: '계정 만들기',
      signIn: '로그인',
      alreadyHaveAccount: '이미 계정이 있으신가요? 아래에서 로그인하세요.',
      or: '또는',
      password: '비밀번호',
      signingIn: '로그인 중…',
      continueWithGoogle: 'Google로 계속하기',
      alreadyHaveOne: '이미 계정이 있으신가요?',
      dateOfBirth: '생년월일',
      dobImmutable: '계정 생성 후에는 변경할 수 없습니다.',
      creatingAccount: '계정 생성 중…',
      signUpWithGoogle: 'Google로 가입하기',
      checkYourEmail: '이메일을 확인해 주세요',
      codeSentPrefix: '8자리 코드를 다음 주소로 보내드렸습니다:',
      codeSentSuffix: '아래에 입력하여 계정을 인증해 주세요.',
      verificationCode: '인증 코드',
      verifying: '인증 중…',
      verify: '인증하기',
      resendCode: '코드 재전송',
      resendCodeWithTimer: (seconds) => `코드 재전송 (${seconds}초)`,
      codeResent: '새 코드가 전송되었습니다.',
      forgotPassword: '비밀번호를 잊으셨나요?',
      forgotPasswordHeading: '비밀번호 재설정',
      forgotPasswordBody: '이메일을 입력하시면 비밀번호 재설정 링크를 보내드립니다.',
      sendResetLink: '재설정 링크 보내기',
      sendingResetLink: '전송 중…',
      resetLinkSentBody:
        '입력하신 이메일로 계정이 존재하는 경우, 비밀번호 재설정 링크를 보내드렸습니다.',
      backToLogin: '로그인으로 돌아가기',
      setNewPasswordHeading: '새 비밀번호 설정',
      setNewPasswordBody: '계정에 사용할 새 비밀번호를 설정해 주세요.',
      newPassword: '새 비밀번호',
      confirmNewPassword: '새 비밀번호 확인',
      passwordsDontMatch: '비밀번호가 일치하지 않습니다',
      updatingPassword: '업데이트 중…',
      updatePassword: '비밀번호 업데이트',
      resetLinkExpired:
        '이 재설정 링크는 유효하지 않거나 만료되었습니다. 다시 요청해 주세요.',
      thanksForReview: '리뷰를 남겨주셔서 감사합니다!',
      reviewAppreciation:
        '소중한 시간 내어주셔서 감사합니다 — 확인 후 상품 페이지에 표시됩니다.',
      backToAccount: '계정으로 돌아가기',
      allDone: '모두 완료되었습니다!',
      alreadyReviewed: (orderNumber) =>
        `주문 ${orderNumber}의 상품을 모두 리뷰하셨습니다. 감사합니다!`,
      howWasIt: '어떠셨나요?',
      rateReviewBody: (orderNumber) =>
        `주문 ${orderNumber}의 상품을 평가하고 리뷰해 주세요. 평가한 상품만 제출됩니다.`,
      reviewPlaceholder: '의견을 남겨주세요 (선택 사항)',
      photoTooLarge: '사진 용량은 8MB 이하여야 합니다.',
      ratingRequired: '제출하기 전에 최소 하나의 상품을 평가해 주세요.',
      submitting: '제출하는 중…',
      submitReview: '리뷰 제출',
      labelOptional: '라벨 (선택 사항)',
      labelPlaceholder: '집, 사무실 등…',
      postalCodeOptional: '우편번호 (선택 사항)',
      defaultShipping: '기본 배송지 주소',
      defaultBilling: '기본 청구지 주소',
      saveAddress: '주소 저장',
      cancel: '취소',
      saving: '저장 중…',
      hidePassword: '비밀번호 숨기기',
      showPassword: '비밀번호 표시',
    },
    emailCapture: {
      title: '첫 구매 10% 할인',
      body: '이메일을 입력하시면 24시간 동안 유효한 일회용 코드를 보내드립니다.',
      emailPlaceholder: '이메일 주소',
      getCode: '코드 받기',
      sending: '전송 중…',
      alreadyCustomer: '이미 회원입니다',
      successMessage: '이메일을 확인해 주세요 — 코드가 곧 도착합니다!',
      alreadyCustomerMessage:
        '이미 저희 고객이신 것 같아요! 이번엔 새 코드는 없지만, 방문해 주셔서 감사합니다.',
      closeAriaLabel: '닫기',
    },
  },
}
