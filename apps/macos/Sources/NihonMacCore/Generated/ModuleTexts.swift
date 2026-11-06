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
    case errorTitle
    case errorBody
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
            .loading: "Loading…",
            .unavailableTitle: "Nihon is not responding",
            .unavailableBody: "Check that Nihon is running, then try again.",
            .incompatibleTitle: "Nihon needs an update",
            .incompatibleBody: "Reload the page. If this message stays, update Nihon.",
            .errorTitle: "Something went wrong",
            .errorBody: "Nihon could not finish this. Try again.",
            .retry: "Try again",
            .notFoundTitle: "Page not found",
            .notFoundBody: "This page does not exist.",
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
            .loading: "Chargement…",
            .unavailableTitle: "Nihon ne répond pas",
            .unavailableBody: "Vérifiez que Nihon est lancé, puis réessayez.",
            .incompatibleTitle: "Une mise à jour de Nihon est nécessaire",
            .incompatibleBody: "Rechargez la page. Si ce message reste affiché, mettez Nihon à jour.",
            .errorTitle: "Une erreur est survenue",
            .errorBody: "Nihon n’a pas pu terminer cette action. Réessayez.",
            .retry: "Réessayer",
            .notFoundTitle: "Page introuvable",
            .notFoundBody: "Cette page n’existe pas.",
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
            .loading: "読み込み中…",
            .unavailableTitle: "Nihonが応答しません",
            .unavailableBody: "Nihonが起動していることを確認して、もう一度お試しください。",
            .incompatibleTitle: "Nihonの更新が必要です",
            .incompatibleBody: "ページを再読み込みしてください。表示が消えない場合は、Nihonを更新してください。",
            .errorTitle: "問題が発生しました",
            .errorBody: "Nihonで処理を完了できませんでした。もう一度お試しください。",
            .retry: "再試行",
            .notFoundTitle: "ページが見つかりません",
            .notFoundBody: "このページはありません。",
            .backHome: "ホームに戻る",
        ],
    ]
}

/// Texts of `apps/macos/Sources/NihonMacCore/Shell/locales`.
public enum MacShellText: String, TextKey {
    case incompatibleTitle
    case incompatibleBody
    case addressTitle
    case addressBody
    case goMenu
    case retryConnection

    public static let source = "apps/macos/Sources/NihonMacCore/Shell/locales"

    public static let table: [Language: [MacShellText: String]] = [
        .en: [
            .incompatibleTitle: "Nihon needs an update",
            .incompatibleBody: "Update Nihon, then try again.",
            .addressTitle: "Nihon cannot open with this setting",
            .addressBody: "A setting added on this Mac stops Nihon from opening. Remove that setting, then open Nihon again.",
            .goMenu: "Go",
            .retryConnection: "Retry Connection",
        ],
        .fr: [
            .incompatibleTitle: "Une mise à jour de Nihon est nécessaire",
            .incompatibleBody: "Mettez Nihon à jour, puis réessayez.",
            .addressTitle: "Nihon ne peut pas s’ouvrir avec ce réglage",
            .addressBody: "Un réglage ajouté sur ce Mac empêche Nihon de s’ouvrir. Retirez ce réglage, puis rouvrez Nihon.",
            .goMenu: "Aller",
            .retryConnection: "Réessayer la connexion",
        ],
        .ja: [
            .incompatibleTitle: "Nihonの更新が必要です",
            .incompatibleBody: "Nihonを更新してから、もう一度お試しください。",
            .addressTitle: "この設定ではNihonを開けません",
            .addressBody: "このMacに追加された設定のため、Nihonを開けません。その設定を削除してから、Nihonをもう一度開いてください。",
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
    case successTitle
    case successBody
    case backHome
    case callbackTitle
    case callbackProgress
    case callbackFailedTitle
    case startAgain
    case tryAgain
    case errorInProgress
    case errorNotAvailable

    public static let source = "apps/web/src/modules/accounts/locales"

    public static let table: [Language: [AccountsText: String]] = [
        .en: [
            .title: "Create your account",
            .usernameLabel: "Username",
            .usernameHint: "3 to 32 characters: letters, digits, _ - or ., starting with a letter or a digit.",
            .passwordLabel: "Password",
            .passwordHint: "8 to 128 characters, different from your username.",
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
            .usernameNeededForProvider: "Choose your username first.",
            .errorUnavailable: "Nihon is not responding. Check that Nihon is running, then try again. What you typed is kept.",
            .errorIncompatible: "This page is out of date. Reload it. If the problem continues, update Nihon.",
            .errorBusy: "Nihon is busy. Try again in a moment.",
            .errorUsernameTaken: "This username is already taken. Choose another one.",
            .errorUsernameInvalid: "This username cannot be used.",
            .errorPasswordInvalid: "This password cannot be used.",
            .errorRequestInvalid: "Nihon could not handle this. Check what you typed and try again.",
            .errorRedirectUri: "Signing up with an existing account does not work here. Use a username and a password instead.",
            .errorProviderUnavailable: "This option is not available. Use a username and a password instead.",
            .errorFlowInvalid: "This sign-up is no longer valid. Start again.",
            .errorFlowExpired: "This sign-up has expired. Start again.",
            .errorCodeRejected: "Signing in with your existing account failed. No account was created. Start again.",
            .errorIdentityUnverified: "Your existing account could not be checked. No account was created. Start again.",
            .errorIdentityRegistered: "This account is already linked to a Nihon profile. No new profile was created.",
            .errorProviderFailed: "Signing in with your existing account did not work. No account was created. Try again later.",
            .errorFlowConsumed: "The sign-up could not be finished. No account was created. Start again.",
            .errorProviderDenied: "The sign-in was not allowed. No account was created.",
            .errorStorage: "This browser blocks the rest of the sign-up. Use a username and a password instead.",
            .errorGeneric: "The account could not be created. Try again.",
            .successTitle: "Account created",
            .successBody: "The account {username} is ready on this computer.",
            .backHome: "Back to home",
            .callbackTitle: "Completing your registration",
            .callbackProgress: "One moment…",
            .callbackFailedTitle: "Registration not completed",
            .startAgain: "Start again",
            .tryAgain: "Try again",
            .errorInProgress: "Your previous attempt is still in progress. Try again in a moment.",
            .errorNotAvailable: "Creating an account is not available right now. Try again later.",
        ],
        .fr: [
            .title: "Créez votre compte",
            .usernameLabel: "Nom d’utilisateur",
            .usernameHint: "De 3 à 32 caractères : lettres, chiffres, _ - ou ., en commençant par une lettre ou un chiffre.",
            .passwordLabel: "Mot de passe",
            .passwordHint: "De 8 à 128 caractères, différent de votre nom d’utilisateur.",
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
            .usernameNeededForProvider: "Choisissez d’abord votre nom d’utilisateur.",
            .errorUnavailable: "Nihon ne répond pas. Vérifiez que Nihon est lancé, puis réessayez. Votre saisie est conservée.",
            .errorIncompatible: "Cette page n’est plus à jour. Rechargez-la. Si le problème continue, mettez Nihon à jour.",
            .errorBusy: "Nihon est occupé. Réessayez dans un instant.",
            .errorUsernameTaken: "Ce nom d’utilisateur est déjà pris. Choisissez-en un autre.",
            .errorUsernameInvalid: "Ce nom d’utilisateur ne convient pas.",
            .errorPasswordInvalid: "Ce mot de passe ne convient pas.",
            .errorRequestInvalid: "Nihon n’a pas pu traiter votre demande. Vérifiez votre saisie et réessayez.",
            .errorRedirectUri: "L’inscription avec un compte existant ne fonctionne pas ici. Utilisez plutôt un nom d’utilisateur et un mot de passe.",
            .errorProviderUnavailable: "Cette option n’est pas disponible. Utilisez plutôt un nom d’utilisateur et un mot de passe.",
            .errorFlowInvalid: "Cette inscription n’est plus valable. Recommencez.",
            .errorFlowExpired: "Cette inscription a expiré. Recommencez.",
            .errorCodeRejected: "La connexion avec votre compte existant a échoué. Aucun compte n’a été créé. Recommencez.",
            .errorIdentityUnverified: "Votre compte existant n’a pas pu être vérifié. Aucun compte n’a été créé. Recommencez.",
            .errorIdentityRegistered: "Ce compte est déjà relié à un profil Nihon. Aucun nouveau profil n’a été créé.",
            .errorProviderFailed: "La connexion avec votre compte existant n’a pas abouti. Aucun compte n’a été créé. Réessayez plus tard.",
            .errorFlowConsumed: "L’inscription n’a pas pu être terminée. Aucun compte n’a été créé. Recommencez.",
            .errorProviderDenied: "La connexion n’a pas été autorisée. Aucun compte n’a été créé.",
            .errorStorage: "Ce navigateur bloque la suite de l’inscription. Utilisez plutôt un nom d’utilisateur et un mot de passe.",
            .errorGeneric: "Le compte n’a pas pu être créé. Réessayez.",
            .successTitle: "Compte créé",
            .successBody: "Le compte {username} est prêt sur cet ordinateur.",
            .backHome: "Retour à l’accueil",
            .callbackTitle: "Finalisation de votre inscription",
            .callbackProgress: "Un instant…",
            .callbackFailedTitle: "Inscription non terminée",
            .startAgain: "Recommencer",
            .tryAgain: "Réessayer",
            .errorInProgress: "Votre demande précédente est encore en cours. Réessayez dans un instant.",
            .errorNotAvailable: "L’inscription n’est pas disponible pour le moment. Réessayez plus tard.",
        ],
        .ja: [
            .title: "アカウントを作成",
            .usernameLabel: "ユーザー名",
            .usernameHint: "3〜32文字：文字・数字・_ - . が使えます。最初は文字か数字にしてください。",
            .passwordLabel: "パスワード",
            .passwordHint: "8〜128文字で、ユーザー名とは違うものにしてください。",
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
            .usernameNeededForProvider: "先にユーザー名を決めてください。",
            .errorUnavailable: "Nihonが応答しません。Nihonが起動していることを確認して、もう一度お試しください。入力した内容はそのまま残ります。",
            .errorIncompatible: "このページは最新ではありません。再読み込みしてください。直らない場合は、Nihonを更新してください。",
            .errorBusy: "Nihonが混み合っています。少し待ってからもう一度お試しください。",
            .errorUsernameTaken: "このユーザー名はすでに使われています。別の名前を選んでください。",
            .errorUsernameInvalid: "このユーザー名は使えません。",
            .errorPasswordInvalid: "このパスワードは使えません。",
            .errorRequestInvalid: "Nihonで処理できませんでした。入力内容を確認して、もう一度お試しください。",
            .errorRedirectUri: "ここでは、お持ちのアカウントでの登録ができません。ユーザー名とパスワードで登録してください。",
            .errorProviderUnavailable: "この方法は利用できません。ユーザー名とパスワードで登録してください。",
            .errorFlowInvalid: "この登録は無効になりました。最初からやり直してください。",
            .errorFlowExpired: "この登録は期限切れになりました。最初からやり直してください。",
            .errorCodeRejected: "お持ちのアカウントでのログインに失敗しました。アカウントは作成されていません。最初からやり直してください。",
            .errorIdentityUnverified: "お持ちのアカウントを確認できませんでした。アカウントは作成されていません。最初からやり直してください。",
            .errorIdentityRegistered: "このアカウントは、すでにNihonのプロフィールにつながっています。新しいプロフィールは作成されていません。",
            .errorProviderFailed: "お持ちのアカウントでのログインがうまくいきませんでした。アカウントは作成されていません。後でもう一度お試しください。",
            .errorFlowConsumed: "登録を完了できませんでした。アカウントは作成されていません。最初からやり直してください。",
            .errorProviderDenied: "ログインが許可されませんでした。アカウントは作成されていません。",
            .errorStorage: "このブラウザーでは登録を続けられません。ユーザー名とパスワードで登録してください。",
            .errorGeneric: "アカウントを作成できませんでした。もう一度お試しください。",
            .successTitle: "アカウントを作成しました",
            .successBody: "アカウント {username} がこのコンピューターに作成されました。",
            .backHome: "ホームに戻る",
            .callbackTitle: "登録を完了しています",
            .callbackProgress: "少々お待ちください…",
            .callbackFailedTitle: "登録は完了していません",
            .startAgain: "最初からやり直す",
            .tryAgain: "もう一度試す",
            .errorInProgress: "前の操作がまだ処理中です。少し待ってからもう一度お試しください。",
            .errorNotAvailable: "現在、アカウントの作成はできません。後でもう一度お試しください。",
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
    case continueWithExistingAccount
    case startingExistingAccount
    case waitingForExistingAccount
    case completing
    case cancel
    case createAccountMenu
    case returnPageTitle
    case returnPageBody

    public static let source = "apps/macos/Sources/NihonMacCore/Accounts/locales"

    public static let table: [Language: [MacAccountsText: String]] = [
        .en: [
            .errorIncompatible: "This app is out of date. Update Nihon, then try again.",
            .errorRedirectUri: "Signing up with an existing account does not work in this app. Use a username and a password instead.",
            .errorListener: "Signing up with an existing account cannot start on this Mac. Use a username and a password instead.",
            .providerClosed: "The sign-in window was closed before the end. No account was created.",
            .providerCancelled: "You cancelled the sign-up. No account was created.",
            .errorListenerLost: "The sign-up stopped on this Mac. No account was created. Try again.",
            .waitingForProvider: "Waiting for {provider}… Finish in the window that opened.",
            .continueWithExistingAccount: "Continue with an existing account",
            .startingExistingAccount: "Opening the sign-in window…",
            .waitingForExistingAccount: "Waiting for the sign-in… Finish in the window that opened.",
            .completing: "Completing your registration…",
            .cancel: "Cancel",
            .createAccountMenu: "Create an Account",
            .returnPageTitle: "Back to Nihon",
            .returnPageBody: "Done. You can close this window and return to Nihon.",
        ],
        .fr: [
            .errorIncompatible: "Cette application n’est plus à jour. Mettez Nihon à jour, puis réessayez.",
            .errorRedirectUri: "L’inscription avec un compte existant ne fonctionne pas dans cette application. Utilisez plutôt un nom d’utilisateur et un mot de passe.",
            .errorListener: "L’inscription avec un compte existant ne peut pas démarrer sur ce Mac. Utilisez plutôt un nom d’utilisateur et un mot de passe.",
            .providerClosed: "La fenêtre de connexion a été fermée avant la fin. Aucun compte n’a été créé.",
            .providerCancelled: "Vous avez annulé l’inscription. Aucun compte n’a été créé.",
            .errorListenerLost: "L’inscription s’est interrompue sur ce Mac. Aucun compte n’a été créé. Réessayez.",
            .waitingForProvider: "En attente de {provider}… Terminez dans la fenêtre qui s’est ouverte.",
            .continueWithExistingAccount: "Continuer avec un compte existant",
            .startingExistingAccount: "Ouverture de la fenêtre de connexion…",
            .waitingForExistingAccount: "En attente de la connexion… Terminez dans la fenêtre qui s’est ouverte.",
            .completing: "Finalisation de votre inscription…",
            .cancel: "Annuler",
            .createAccountMenu: "Créer un compte",
            .returnPageTitle: "Retour dans Nihon",
            .returnPageBody: "C’est fait. Vous pouvez fermer cette fenêtre et revenir dans Nihon.",
        ],
        .ja: [
            .errorIncompatible: "このアプリは最新ではありません。Nihonを更新してから、もう一度お試しください。",
            .errorRedirectUri: "このアプリでは、既存のアカウントで登録できません。ユーザー名とパスワードを使ってください。",
            .errorListener: "このMacでは、既存のアカウントでの登録を開始できません。ユーザー名とパスワードを使ってください。",
            .providerClosed: "最後まで終わる前にサインインのウインドウが閉じられました。アカウントは作成されていません。",
            .providerCancelled: "登録をキャンセルしました。アカウントは作成されていません。",
            .errorListenerLost: "このMacで登録が中断されました。アカウントは作成されていません。もう一度お試しください。",
            .waitingForProvider: "{provider}を待っています… 開いたウインドウで手続きを完了してください。",
            .continueWithExistingAccount: "既存のアカウントで続ける",
            .startingExistingAccount: "ログイン画面を開いています…",
            .waitingForExistingAccount: "ログインを待っています… 開いたウィンドウで完了してください。",
            .completing: "登録を完了しています…",
            .cancel: "キャンセル",
            .createAccountMenu: "アカウントを作成",
            .returnPageTitle: "Nihonに戻る",
            .returnPageBody: "完了しました。このウインドウを閉じて、Nihonに戻ってください。",
        ],
    ]
}
