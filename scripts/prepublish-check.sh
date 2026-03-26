#!/usr/bin/env bash
set -euo pipefail

# Pre-publish safety gate for @kyalabs npm packages
# Runs automatically via prepublishOnly hook in package.json

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
FAIL=0

echo "=== Pre-publish checks ==="

# 1. Build
echo -n "Build... "
npm run build --silent 2>/dev/null && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAIL${NC}"; FAIL=1; }

# 2. Tests
echo -n "Tests... "
npx vitest run --silent 2>/dev/null && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAIL${NC}"; FAIL=1; }

# 3. Lint
echo -n "Lint... "
npm run lint --silent 2>/dev/null && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAIL${NC}"; FAIL=1; }

# 4. npm audit (production deps only)
echo -n "Audit (prod deps)... "
npm audit --omit=dev --audit-level=high 2>/dev/null && echo -e "${GREEN}OK${NC}" || { echo -e "${RED}FAIL${NC}"; FAIL=1; }

# 5. No console.log in dist/
echo -n "console.log sweep... "
if grep -r "console\.log" dist/ 2>/dev/null | grep -v "node_modules" | grep -q .; then
  echo -e "${RED}FAIL — console.log found in dist/${NC}"
  grep -rn "console\.log" dist/ | grep -v "node_modules" | head -5
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 6. No leaked internal URLs in dist/
# Exclude validation code that references localhost to *block* it (not leak it)
echo -n "Internal URL sweep... "
if grep -rE "vercel\.app|supabase\.co" dist/ 2>/dev/null | grep -q .; then
  echo -e "${RED}FAIL — internal URLs found in dist/${NC}"
  grep -rnE "vercel\.app|supabase\.co" dist/ | head -5
  FAIL=1
else
  echo -e "${GREEN}OK${NC}"
fi

# 7. Version differs from npm (intentional bump check)
echo -n "Version bump... "
PKG_NAME=$(node -p "require('./package.json').name")
LOCAL_VER=$(node -p "require('./package.json').version")
NPM_VER=$(npm view "$PKG_NAME" version 2>/dev/null || echo "0.0.0")
if [ "$LOCAL_VER" = "$NPM_VER" ]; then
  echo -e "${RED}FAIL — version $LOCAL_VER already published. Bump first.${NC}"
  FAIL=1
else
  echo -e "${GREEN}OK${NC} ($NPM_VER -> $LOCAL_VER)"
fi

# 8. CHANGELOG has entry for this version
echo -n "CHANGELOG entry... "
if grep -q "\[$LOCAL_VER\]" CHANGELOG.md 2>/dev/null; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}FAIL — no CHANGELOG entry for $LOCAL_VER${NC}"
  FAIL=1
fi

# 9. npm pack dry run (informational — review what ships)
echo ""
echo "=== Pack contents ==="
npm pack --dry-run 2>&1

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}Pre-publish checks FAILED. Fix issues above before publishing.${NC}"
  exit 1
fi
echo -e "${GREEN}All checks passed. Safe to publish.${NC}"
