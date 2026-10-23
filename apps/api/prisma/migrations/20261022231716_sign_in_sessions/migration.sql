-- CreateTable
CREATE TABLE "OAuthSignInFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stateHash" TEXT NOT NULL,
    "bindingHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "signedInWith" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthSignInFlow_stateHash_key" ON "OAuthSignInFlow"("stateHash");

-- CreateIndex
CREATE INDEX "OAuthSignInFlow_bindingHash_idx" ON "OAuthSignInFlow"("bindingHash");

-- CreateIndex
CREATE INDEX "OAuthSignInFlow_expiresAt_idx" ON "OAuthSignInFlow"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_profileId_createdAt_idx" ON "Session"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

