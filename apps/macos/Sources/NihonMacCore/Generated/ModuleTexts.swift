// Generated from the shared JSON files. Do not edit: run `bun run macos:generate`.

/// Texts of `apps/web/src/shell/locales`.
public enum ShellText: String, TextKey {
    case documentTitle
    case skipToContent
    case navigationLabel
    case accountNavigationLabel
    case navHome
    case navLearning
    case navKanji
    case navLibrary
    case navProfile
    case navAdmin
    case loading
    case unavailableTitle
    case unavailableBody
    case incompatibleTitle
    case incompatibleBody
    case incompatibleVersions
    case errorTitle
    case errorBody
    case errorReference
    case retry
    case notFoundTitle
    case notFoundBody
    case backHome

    public static let source = "apps/web/src/shell/locales"

    public static let table: [Language: [ShellText: String]] = [
        .en: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "Skip to content",
            .navigationLabel: "Main navigation",
            .accountNavigationLabel: "Account",
            .navHome: "Home",
            .navLearning: "Learn",
            .navKanji: "Kanji",
            .navLibrary: "Library",
            .navProfile: "Profile",
            .navAdmin: "Administration",
            .loading: "Connecting to the Nihon service…",
            .unavailableTitle: "The Nihon service is not responding",
            .unavailableBody: "Check that Nihon is running on this computer, then try again.",
            .incompatibleTitle: "This page needs an update",
            .incompatibleBody: "This page was built for another version of the Nihon service. Reload the page; if the message remains, update Nihon.",
            .incompatibleVersions: "Service API version {serverVersion}; this page expects version {clientVersion}.",
            .errorTitle: "Something went wrong",
            .errorBody: "The Nihon service could not complete the request.",
            .errorReference: "Reference for the service log: {requestId}",
            .retry: "Try again",
            .notFoundTitle: "Page not found",
            .notFoundBody: "No page of Nihon has this address.",
            .backHome: "Back to home",
        ],
        .fr: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "Aller au contenu",
            .navigationLabel: "Navigation principale",
            .accountNavigationLabel: "Compte",
            .navHome: "Accueil",
            .navLearning: "Apprendre",
            .navKanji: "Kanji",
            .navLibrary: "Bibliothèque",
            .navProfile: "Profil",
            .navAdmin: "Administration",
            .loading: "Connexion au service Nihon…",
            .unavailableTitle: "Le service Nihon ne répond pas",
            .unavailableBody: "Vérifiez que Nihon fonctionne sur cet ordinateur, puis réessayez.",
            .incompatibleTitle: "Cette page doit être mise à jour",
            .incompatibleBody: "Cette page a été construite pour une autre version du service Nihon. Rechargez la page ; si le message persiste, mettez Nihon à jour.",
            .incompatibleVersions: "Version de l’API du service : {serverVersion} ; cette page attend la version {clientVersion}.",
            .errorTitle: "Une erreur est survenue",
            .errorBody: "Le service Nihon n’a pas pu traiter la demande.",
            .errorReference: "Référence pour le journal du service : {requestId}",
            .retry: "Réessayer",
            .notFoundTitle: "Page introuvable",
            .notFoundBody: "Aucune page de Nihon ne correspond à cette adresse.",
            .backHome: "Retour à l’accueil",
        ],
        .ja: [
            .documentTitle: "{page} · Nihon",
            .skipToContent: "本文へ移動",
            .navigationLabel: "メインナビゲーション",
            .accountNavigationLabel: "アカウント",
            .navHome: "ホーム",
            .navLearning: "学習",
            .navKanji: "漢字",
            .navLibrary: "ライブラリ",
            .navProfile: "プロフィール",
            .navAdmin: "管理",
            .loading: "Nihon サービスに接続しています…",
            .unavailableTitle: "Nihon サービスが応答しません",
            .unavailableBody: "このコンピューターで Nihon が起動していることを確認して、もう一度お試しください。",
            .incompatibleTitle: "このページの更新が必要です",
            .incompatibleBody: "このページは別のバージョンの Nihon サービス向けに作られています。ページを再読み込みしてください。表示が消えない場合は Nihon を更新してください。",
            .incompatibleVersions: "サービスの API バージョンは {serverVersion}、このページが必要とするバージョンは {clientVersion} です。",
            .errorTitle: "問題が発生しました",
            .errorBody: "Nihon サービスはリクエストを完了できませんでした。",
            .errorReference: "サービスログの参照番号：{requestId}",
            .retry: "再試行",
            .notFoundTitle: "ページが見つかりません",
            .notFoundBody: "このアドレスの Nihon ページはありません。",
            .backHome: "ホームに戻る",
        ],
    ]
}

/// Texts of `apps/macos/Sources/NihonMacCore/Shell/locales`.
public enum MacShellText: String, TextKey {
    case incompatibleTitle
    case incompatibleBody
    case incompatibleVersions
    case serviceAddress
    case addressTitle
    case addressBody
    case goMenu
    case retryConnection

    public static let source = "apps/macos/Sources/NihonMacCore/Shell/locales"

    public static let table: [Language: [MacShellText: String]] = [
        .en: [
            .incompatibleTitle: "Nihon needs an update",
            .incompatibleBody: "This app was built for another version of the Nihon service. Update the app or the service so that their versions match, then try again.",
            .incompatibleVersions: "Service API version {serverVersion}; this app expects version {clientVersion}.",
            .serviceAddress: "Service address: {address}",
            .addressTitle: "The service address is not allowed",
            .addressBody: "Nihon only connects to a service on this computer. Remove the NihonServiceURL setting or give it a loopback address such as http://127.0.0.1:4000.",
            .goMenu: "Go",
            .retryConnection: "Retry Connection",
        ],
        .fr: [
            .incompatibleTitle: "Nihon doit être mis à jour",
            .incompatibleBody: "Cette application a été construite pour une autre version du service Nihon. Mettez à jour l’application ou le service pour que leurs versions correspondent, puis réessayez.",
            .incompatibleVersions: "Version de l’API du service : {serverVersion} ; cette application attend la version {clientVersion}.",
            .serviceAddress: "Adresse du service : {address}",
            .addressTitle: "L’adresse du service n’est pas autorisée",
            .addressBody: "Nihon se connecte uniquement à un service de cet ordinateur. Supprimez le réglage NihonServiceURL ou donnez-lui une adresse de bouclage comme http://127.0.0.1:4000.",
            .goMenu: "Aller",
            .retryConnection: "Réessayer la connexion",
        ],
        .ja: [
            .incompatibleTitle: "Nihon の更新が必要です",
            .incompatibleBody: "このアプリは別のバージョンの Nihon サービス向けに作られています。アプリまたはサービスを更新してバージョンを合わせてから、もう一度お試しください。",
            .incompatibleVersions: "サービスの API バージョンは {serverVersion}、このアプリが必要とするバージョンは {clientVersion} です。",
            .serviceAddress: "サービスのアドレス：{address}",
            .addressTitle: "このサービスのアドレスは使用できません",
            .addressBody: "Nihon はこのコンピューター上のサービスにのみ接続します。NihonServiceURL の設定を削除するか、http://127.0.0.1:4000 のようなループバックアドレスを指定してください。",
            .goMenu: "移動",
            .retryConnection: "接続を再試行",
        ],
    ]
}

/// Texts of `apps/web/src/modules/home/locales`.
public enum HomeText: String, TextKey {
    case title
    case eyebrow
    case practiceTitle
    case practiceBody
    case startReview
    case discoverKana

    public static let source = "apps/web/src/modules/home/locales"

    public static let table: [Language: [HomeText: String]] = [
        .en: [
            .title: "Home",
            .eyebrow: "Your practice",
            .practiceTitle: "Kana review",
            .practiceBody: "Your due reviews and progress will appear here once kana learning is available.",
            .startReview: "Start review",
            .discoverKana: "Discover new kana",
        ],
        .fr: [
            .title: "Accueil",
            .eyebrow: "Votre entraînement",
            .practiceTitle: "Révision des kana",
            .practiceBody: "Vos révisions à faire et votre progression apparaîtront ici dès que l’apprentissage des kana sera disponible.",
            .startReview: "Commencer la révision",
            .discoverKana: "Découvrir de nouveaux kana",
        ],
        .ja: [
            .title: "ホーム",
            .eyebrow: "あなたの練習",
            .practiceTitle: "かなの復習",
            .practiceBody: "かなの学習が利用できるようになると、復習予定と進捗がここに表示されます。",
            .startReview: "復習を始める",
            .discoverKana: "新しいかなを覚える",
        ],
    ]
}

/// Texts of `apps/web/src/modules/learning/locales`.
public enum LearningText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/learning/locales"

    public static let table: [Language: [LearningText: String]] = [
        .en: [
            .title: "Learn",
            .body: "Kana lessons, reviews, and custom practice will appear here.",
        ],
        .fr: [
            .title: "Apprendre",
            .body: "Les leçons de kana, les révisions et l’entraînement personnalisé apparaîtront ici.",
        ],
        .ja: [
            .title: "学習",
            .body: "かなのレッスン、復習、カスタム練習がここに表示されます。",
        ],
    ]
}

/// Texts of `apps/web/src/modules/kanji/locales`.
public enum KanjiText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/kanji/locales"

    public static let table: [Language: [KanjiText: String]] = [
        .en: [
            .title: "Kanji",
            .body: "The kanji explorer and dictionary will appear here.",
        ],
        .fr: [
            .title: "Kanji",
            .body: "L’explorateur de kanji et le dictionnaire apparaîtront ici.",
        ],
        .ja: [
            .title: "漢字",
            .body: "漢字エクスプローラーと辞書がここに表示されます。",
        ],
    ]
}

/// Texts of `apps/web/src/modules/library/locales`.
public enum LibraryText: String, TextKey {
    case title
    case body
    case readerTitle
    case readerMedia
    case readerPending
    case readerMissing
    case backToLibrary

    public static let source = "apps/web/src/modules/library/locales"

    public static let table: [Language: [LibraryText: String]] = [
        .en: [
            .title: "Library",
            .body: "Your media and collections will appear here.",
            .readerTitle: "Reader",
            .readerMedia: "Media {mediaId}",
            .readerPending: "The player for this media arrives with the media features.",
            .readerMissing: "No media is selected. Open a media item from the library.",
            .backToLibrary: "Back to the library",
        ],
        .fr: [
            .title: "Bibliothèque",
            .body: "Vos médias et vos collections apparaîtront ici.",
            .readerTitle: "Lecteur",
            .readerMedia: "Média {mediaId}",
            .readerPending: "Le lecteur de ce média arrivera avec les fonctionnalités médias.",
            .readerMissing: "Aucun média n’est sélectionné. Ouvrez un média depuis la bibliothèque.",
            .backToLibrary: "Retour à la bibliothèque",
        ],
        .ja: [
            .title: "ライブラリ",
            .body: "メディアとコレクションがここに表示されます。",
            .readerTitle: "プレーヤー",
            .readerMedia: "メディア {mediaId}",
            .readerPending: "このメディアのプレーヤーはメディア機能とともに提供されます。",
            .readerMissing: "メディアが選択されていません。ライブラリからメディアを開いてください。",
            .backToLibrary: "ライブラリに戻る",
        ],
    ]
}

/// Texts of `apps/web/src/modules/profile/locales`.
public enum ProfileText: String, TextKey {
    case title
    case body
    case displayTitle
    case displayNote
    case language
    case style
    case mode
    case modeSystem
    case modeLight
    case modeDark
    case createAccount

    public static let source = "apps/web/src/modules/profile/locales"

    public static let table: [Language: [ProfileText: String]] = [
        .en: [
            .title: "Profile",
            .body: "Your profile and account settings will appear here.",
            .displayTitle: "Display",
            .displayNote: "These choices apply to this page until profile preferences are available.",
            .language: "Language",
            .style: "Style",
            .mode: "Mode",
            .modeSystem: "System",
            .modeLight: "Light",
            .modeDark: "Dark",
            .createAccount: "Create an account",
        ],
        .fr: [
            .title: "Profil",
            .body: "Votre profil et les réglages de votre compte apparaîtront ici.",
            .displayTitle: "Affichage",
            .displayNote: "Ces choix s’appliquent à cette page jusqu’à l’arrivée des préférences du profil.",
            .language: "Langue",
            .style: "Style",
            .mode: "Mode",
            .modeSystem: "Système",
            .modeLight: "Clair",
            .modeDark: "Sombre",
            .createAccount: "Créer un compte",
        ],
        .ja: [
            .title: "プロフィール",
            .body: "プロフィールとアカウント設定がここに表示されます。",
            .displayTitle: "表示",
            .displayNote: "プロフィールの設定が利用できるようになるまで、これらの選択はこのページにのみ適用されます。",
            .language: "言語",
            .style: "スタイル",
            .mode: "モード",
            .modeSystem: "システム",
            .modeLight: "ライト",
            .modeDark: "ダーク",
            .createAccount: "アカウントを作成",
        ],
    ]
}

/// Texts of `apps/web/src/modules/admin/locales`.
public enum AdminText: String, TextKey {
    case title
    case body

    public static let source = "apps/web/src/modules/admin/locales"

    public static let table: [Language: [AdminText: String]] = [
        .en: [
            .title: "Administration",
            .body: "Administration tools will appear here for administrators.",
        ],
        .fr: [
            .title: "Administration",
            .body: "Les outils d’administration apparaîtront ici pour les administrateurs.",
        ],
        .ja: [
            .title: "管理",
            .body: "管理者向けの管理ツールがここに表示されます。",
        ],
    ]
}

/// Texts of `apps/web/src/modules/accounts/locales`.
public enum AccountsText: String, TextKey {
    case title
    case usernameLabel
    case usernameHint
    case passwordLabel
    case passwordHint
    case confirmationLabel
    case showPassword
    case hidePassword
    case showConfirmation
    case hideConfirmation
    case submit
    case submitting
    case providersTitle
    case continueWithProvider
    case providerGoogle
    case providerGithub
    case startingProvider
    case usernameRequired
    case passwordRequired
    case passwordsDiffer
    case usernameNeededForProvider
    case errorUnavailable
    case errorIncompatible
    case errorBusy
    case errorUsernameTaken
    case errorUsernameInvalid
    case errorPasswordInvalid
    case errorRequestInvalid
    case errorRedirectUri
    case errorProviderUnavailable
    case errorFlowInvalid
    case errorFlowExpired
    case errorCodeRejected
    case errorIdentityUnverified
    case errorIdentityRegistered
    case errorProviderFailed
    case errorFlowConsumed
    case errorProviderDenied
    case errorStorage
    case errorGeneric
    case errorReference
    case successTitle
    case successBody
    case backHome
    case callbackTitle
    case callbackProgress
    case callbackFailedTitle
    case startAgain
    case tryAgain
    case errorInProgress

    public static let source = "apps/web/src/modules/accounts/locales"

    public static let table: [Language: [AccountsText: String]] = [
        .en: [
            .title: "Create your account",
            .usernameLabel: "Username",
            .usernameHint: "3 to 32 characters: letters, digits, _ - or .",
            .passwordLabel: "Password",
            .passwordHint: "At least 8 characters.",
            .confirmationLabel: "Confirm password",
            .showPassword: "Show password",
            .hidePassword: "Hide password",
            .showConfirmation: "Show confirmation",
            .hideConfirmation: "Hide confirmation",
            .submit: "Create account",
            .submitting: "Creating your account…",
            .providersTitle: "Or use an existing account",
            .continueWithProvider: "Continue with {provider}",
            .providerGoogle: "Google",
            .providerGithub: "GitHub",
            .startingProvider: "Opening {provider}…",
            .usernameRequired: "Enter a username.",
            .passwordRequired: "Enter a password.",
            .passwordsDiffer: "The two passwords are different.",
            .usernameNeededForProvider: "Choose the username you want to use before continuing with a provider.",
            .errorUnavailable: "Nihon cannot reach its service. Check that it is running on this computer, then try again. What you typed is kept.",
            .errorIncompatible: "This page was built for another version of the Nihon service. Reload the page; if the message remains, update Nihon.",
            .errorBusy: "The service is busy. Try again in a moment.",
            .errorUsernameTaken: "This username is already used. Choose another one.",
            .errorUsernameInvalid: "This username is not accepted. Use 3 to 32 letters, digits, _ - or ., starting with a letter or a digit.",
            .errorPasswordInvalid: "This password is not accepted. Use 8 to 128 characters that differ from your username.",
            .errorRequestInvalid: "The service refused this request. Check what you typed and try again.",
            .errorRedirectUri: "This address cannot be used to return from the provider. Open Nihon at http://127.0.0.1 or http://localhost, or use the username and password form.",
            .errorProviderUnavailable: "This provider is not available on this installation. Use the username and password form.",
            .errorFlowInvalid: "This registration attempt is no longer valid. Start again.",
            .errorFlowExpired: "This registration attempt took too long and has expired. Start again.",
            .errorCodeRejected: "The provider refused the authorization. Nothing was created. Start again.",
            .errorIdentityUnverified: "The provider's answer could not be verified. Nothing was created. Start again.",
            .errorIdentityRegistered: "This provider account already has a Nihon profile. No second profile was created.",
            .errorProviderFailed: "The provider could not be reached or gave an unusable answer. Nothing was created. Try again later.",
            .errorFlowConsumed: "The registration could not be completed and this attempt is used up. Nothing was created. Start again.",
            .errorProviderDenied: "The provider did not allow the registration. Nothing was created.",
            .errorStorage: "This browser does not let Nihon continue the registration after the provider's page. Use the username and password form.",
            .errorGeneric: "The registration could not be completed. Try again.",
            .errorReference: "Reference for the service log: {requestId}",
            .successTitle: "Account created",
            .successBody: "The account {username} is ready on this computer.",
            .backHome: "Back to home",
            .callbackTitle: "Completing your registration",
            .callbackProgress: "Confirming your registration with the provider…",
            .callbackFailedTitle: "Registration not completed",
            .startAgain: "Start again",
            .tryAgain: "Try again",
            .errorInProgress: "A previous attempt is still being processed. Try again in a moment.",
        ],
        .fr: [
            .title: "Créez votre compte",
            .usernameLabel: "Nom d’utilisateur",
            .usernameHint: "De 3 à 32 caractères : lettres, chiffres, _ - ou .",
            .passwordLabel: "Mot de passe",
            .passwordHint: "Au moins 8 caractères.",
            .confirmationLabel: "Confirmer le mot de passe",
            .showPassword: "Afficher le mot de passe",
            .hidePassword: "Masquer le mot de passe",
            .showConfirmation: "Afficher la confirmation",
            .hideConfirmation: "Masquer la confirmation",
            .submit: "Créer le compte",
            .submitting: "Création du compte…",
            .providersTitle: "Ou utilisez un compte existant",
            .continueWithProvider: "Continuer avec {provider}",
            .providerGoogle: "Google",
            .providerGithub: "GitHub",
            .startingProvider: "Ouverture de {provider}…",
            .usernameRequired: "Saisissez un nom d’utilisateur.",
            .passwordRequired: "Saisissez un mot de passe.",
            .passwordsDiffer: "Les deux mots de passe sont différents.",
            .usernameNeededForProvider: "Choisissez le nom d’utilisateur voulu avant de continuer avec un fournisseur.",
            .errorUnavailable: "Nihon ne parvient pas à joindre son service. Vérifiez qu’il fonctionne sur cet ordinateur, puis réessayez. Ce que vous avez saisi est conservé.",
            .errorIncompatible: "Cette page a été conçue pour une autre version du service Nihon. Rechargez la page ; si le message reste, mettez Nihon à jour.",
            .errorBusy: "Le service est occupé. Réessayez dans un instant.",
            .errorUsernameTaken: "Ce nom d’utilisateur est déjà pris. Choisissez-en un autre.",
            .errorUsernameInvalid: "Ce nom d’utilisateur n’est pas accepté. Utilisez de 3 à 32 lettres, chiffres, _ - ou ., en commençant par une lettre ou un chiffre.",
            .errorPasswordInvalid: "Ce mot de passe n’est pas accepté. Utilisez de 8 à 128 caractères, différents de votre nom d’utilisateur.",
            .errorRequestInvalid: "Le service a refusé cette demande. Vérifiez votre saisie et réessayez.",
            .errorRedirectUri: "Cette adresse ne peut pas servir au retour depuis le fournisseur. Ouvrez Nihon sur http://127.0.0.1 ou http://localhost, ou utilisez le formulaire avec nom d’utilisateur et mot de passe.",
            .errorProviderUnavailable: "Ce fournisseur n’est pas disponible sur cette installation. Utilisez le formulaire avec nom d’utilisateur et mot de passe.",
            .errorFlowInvalid: "Cette tentative d’inscription n’est plus valide. Recommencez.",
            .errorFlowExpired: "Cette tentative d’inscription a pris trop de temps et a expiré. Recommencez.",
            .errorCodeRejected: "Le fournisseur a refusé l’autorisation. Rien n’a été créé. Recommencez.",
            .errorIdentityUnverified: "La réponse du fournisseur n’a pas pu être vérifiée. Rien n’a été créé. Recommencez.",
            .errorIdentityRegistered: "Ce compte du fournisseur a déjà un profil Nihon. Aucun second profil n’a été créé.",
            .errorProviderFailed: "Le fournisseur est injoignable ou a donné une réponse inutilisable. Rien n’a été créé. Réessayez plus tard.",
            .errorFlowConsumed: "L’inscription n’a pas pu être terminée et cette tentative est épuisée. Rien n’a été créé. Recommencez.",
            .errorProviderDenied: "Le fournisseur n’a pas autorisé l’inscription. Rien n’a été créé.",
            .errorStorage: "Ce navigateur ne permet pas à Nihon de poursuivre l’inscription après la page du fournisseur. Utilisez le formulaire avec nom d’utilisateur et mot de passe.",
            .errorGeneric: "L’inscription n’a pas pu être terminée. Réessayez.",
            .errorReference: "Référence pour le journal du service : {requestId}",
            .successTitle: "Compte créé",
            .successBody: "Le compte {username} est prêt sur cet ordinateur.",
            .backHome: "Retour à l’accueil",
            .callbackTitle: "Finalisation de votre inscription",
            .callbackProgress: "Confirmation de l’inscription auprès du fournisseur…",
            .callbackFailedTitle: "Inscription non terminée",
            .startAgain: "Recommencer",
            .tryAgain: "Réessayer",
            .errorInProgress: "Une tentative précédente est encore en cours de traitement. Réessayez dans un instant.",
        ],
        .ja: [
            .title: "アカウントを作成",
            .usernameLabel: "ユーザー名",
            .usernameHint: "3〜32文字：文字、数字、_ - または .",
            .passwordLabel: "パスワード",
            .passwordHint: "8文字以上。",
            .confirmationLabel: "パスワードの確認",
            .showPassword: "パスワードを表示",
            .hidePassword: "パスワードを非表示",
            .showConfirmation: "確認用パスワードを表示",
            .hideConfirmation: "確認用パスワードを非表示",
            .submit: "アカウントを作成",
            .submitting: "アカウントを作成しています…",
            .providersTitle: "または既存のアカウントを使う",
            .continueWithProvider: "{provider}で続ける",
            .providerGoogle: "Google",
            .providerGithub: "GitHub",
            .startingProvider: "{provider}を開いています…",
            .usernameRequired: "ユーザー名を入力してください。",
            .passwordRequired: "パスワードを入力してください。",
            .passwordsDiffer: "2つのパスワードが一致しません。",
            .usernameNeededForProvider: "プロバイダーで続ける前に、使用するユーザー名を入力してください。",
            .errorUnavailable: "Nihonのサービスに接続できません。このコンピューターで起動していることを確認して、もう一度お試しください。入力した内容は保持されています。",
            .errorIncompatible: "このページは別のバージョンのNihonサービス用に作られています。ページを再読み込みしてください。表示が消えない場合はNihonを更新してください。",
            .errorBusy: "サービスが混み合っています。しばらくしてからもう一度お試しください。",
            .errorUsernameTaken: "このユーザー名はすでに使われています。別の名前を選んでください。",
            .errorUsernameInvalid: "このユーザー名は使用できません。文字または数字で始まる、文字・数字・_ - . の3〜32文字にしてください。",
            .errorPasswordInvalid: "このパスワードは使用できません。ユーザー名とは異なる8〜128文字にしてください。",
            .errorRequestInvalid: "サービスがこのリクエストを受け付けませんでした。入力内容を確認してもう一度お試しください。",
            .errorRedirectUri: "このアドレスはプロバイダーからの戻り先に使えません。Nihonを http://127.0.0.1 または http://localhost で開くか、ユーザー名とパスワードのフォームを使ってください。",
            .errorProviderUnavailable: "このプロバイダーはこのインストールでは利用できません。ユーザー名とパスワードのフォームを使ってください。",
            .errorFlowInvalid: "この登録手続きはもう有効ではありません。最初からやり直してください。",
            .errorFlowExpired: "この登録手続きは時間がかかりすぎて期限切れになりました。最初からやり直してください。",
            .errorCodeRejected: "プロバイダーが認可を拒否しました。何も作成されていません。最初からやり直してください。",
            .errorIdentityUnverified: "プロバイダーの応答を確認できませんでした。何も作成されていません。最初からやり直してください。",
            .errorIdentityRegistered: "このプロバイダーのアカウントには、すでにNihonのプロフィールがあります。2つ目のプロフィールは作成されていません。",
            .errorProviderFailed: "プロバイダーに接続できないか、応答が使えませんでした。何も作成されていません。後でもう一度お試しください。",
            .errorFlowConsumed: "登録を完了できず、この手続きは使用済みになりました。何も作成されていません。最初からやり直してください。",
            .errorProviderDenied: "プロバイダーが登録を許可しませんでした。何も作成されていません。",
            .errorStorage: "このブラウザーでは、プロバイダーのページの後に登録を続けられません。ユーザー名とパスワードのフォームを使ってください。",
            .errorGeneric: "登録を完了できませんでした。もう一度お試しください。",
            .errorReference: "サービスログの参照番号：{requestId}",
            .successTitle: "アカウントを作成しました",
            .successBody: "アカウント {username} がこのコンピューターに作成されました。",
            .backHome: "ホームに戻る",
            .callbackTitle: "登録を完了しています",
            .callbackProgress: "プロバイダーで登録を確認しています…",
            .callbackFailedTitle: "登録は完了していません",
            .startAgain: "最初からやり直す",
            .tryAgain: "もう一度試す",
            .errorInProgress: "前回の試行がまだ処理中です。しばらくしてからもう一度お試しください。",
        ],
    ]
}

/// Texts of `apps/macos/Sources/NihonMacCore/Accounts/locales`.
public enum MacAccountsText: String, TextKey {
    case errorIncompatible
    case errorRedirectUri
    case errorListener
    case providerClosed
    case providerCancelled
    case errorListenerLost
    case waitingForProvider
    case completing
    case cancel
    case createAccountMenu
    case returnPageTitle
    case returnPageBody

    public static let source = "apps/macos/Sources/NihonMacCore/Accounts/locales"

    public static let table: [Language: [MacAccountsText: String]] = [
        .en: [
            .errorIncompatible: "This app was built for another version of the Nihon service. Update the app or the service so that their versions match, then try again.",
            .errorRedirectUri: "The service does not accept the address this app uses to come back from the provider. Use the username and password form.",
            .errorListener: "Nihon could not prepare to receive the provider's answer on this Mac. Use the username and password form.",
            .providerClosed: "The provider's window was closed before the registration ended. Nothing was created.",
            .providerCancelled: "You cancelled the registration with the provider. Nothing was created.",
            .errorListenerLost: "Nihon stopped receiving the provider's answer on this Mac. Nothing was created; try again.",
            .waitingForProvider: "Waiting for {provider}… Finish in the window that opened.",
            .completing: "Completing your registration…",
            .cancel: "Cancel",
            .createAccountMenu: "Create an Account",
            .returnPageTitle: "Back to Nihon",
            .returnPageBody: "The provider answered. You can close this window and return to Nihon.",
        ],
        .fr: [
            .errorIncompatible: "Cette app a été conçue pour une autre version du service Nihon. Mettez à jour l'app ou le service pour que leurs versions correspondent, puis réessayez.",
            .errorRedirectUri: "Le service n'accepte pas l'adresse que cette app utilise pour revenir du fournisseur. Utilisez le formulaire avec nom d'utilisateur et mot de passe.",
            .errorListener: "Nihon n'a pas pu se préparer à recevoir la réponse du fournisseur sur ce Mac. Utilisez le formulaire avec nom d'utilisateur et mot de passe.",
            .providerClosed: "La fenêtre du fournisseur a été fermée avant la fin de l'inscription. Rien n'a été créé.",
            .providerCancelled: "Vous avez annulé l'inscription auprès du fournisseur. Rien n'a été créé.",
            .errorListenerLost: "Nihon a cessé de pouvoir recevoir la réponse du fournisseur sur ce Mac. Rien n'a été créé ; réessayez.",
            .waitingForProvider: "En attente de {provider}… Terminez dans la fenêtre qui s'est ouverte.",
            .completing: "Finalisation de votre inscription…",
            .cancel: "Annuler",
            .createAccountMenu: "Créer un compte",
            .returnPageTitle: "Retour dans Nihon",
            .returnPageBody: "Le fournisseur a répondu. Vous pouvez fermer cette fenêtre et revenir dans Nihon.",
        ],
        .ja: [
            .errorIncompatible: "このアプリは別のバージョンのNihonサービス向けに作られています。アプリまたはサービスを更新してバージョンを合わせてから、もう一度お試しください。",
            .errorRedirectUri: "プロバイダーから戻るためにこのアプリが使うアドレスを、サービスが受け付けませんでした。ユーザー名とパスワードのフォームをご利用ください。",
            .errorListener: "このMacでプロバイダーからの応答を受け取る準備ができませんでした。ユーザー名とパスワードのフォームをご利用ください。",
            .providerClosed: "登録が終わる前にプロバイダーのウインドウが閉じられました。何も作成されていません。",
            .providerCancelled: "プロバイダーでの登録をキャンセルしました。何も作成されていません。",
            .errorListenerLost: "このMacでプロバイダーからの応答を受け取れなくなりました。何も作成されていません。もう一度お試しください。",
            .waitingForProvider: "{provider}を待っています… 開いたウインドウで手続きを完了してください。",
            .completing: "登録を完了しています…",
            .cancel: "キャンセル",
            .createAccountMenu: "アカウントを作成",
            .returnPageTitle: "Nihonに戻る",
            .returnPageBody: "プロバイダーから応答がありました。このウインドウを閉じてNihonに戻ってください。",
        ],
    ]
}
