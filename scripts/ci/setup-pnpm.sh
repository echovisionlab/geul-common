#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TOOL_CACHE:?RUNNER_TOOL_CACHE is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"

package_manager="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("package.json", "utf8")).packageManager ?? "")')"
if ! [[ "${package_manager}" =~ ^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  echo "package.json packageManager must pin an exact pnpm semantic version." >&2
  exit 1
fi
pnpm_version="${BASH_REMATCH[1]}"

pnpm_cache_root="${RUNNER_TOOL_CACHE}/pnpm"
pnpm_root="${pnpm_cache_root}/${pnpm_version}"
pnpm_bin="${pnpm_root}/bin/pnpm"

mkdir -p "${pnpm_cache_root}"

installed_version=""
if [ -x "${pnpm_bin}" ]; then
  installed_version="$("${pnpm_bin}" --version 2>/dev/null || true)"
fi

if [ "${installed_version}" != "${pnpm_version}" ]; then
  staging_root="$(mktemp -d "${RUNNER_TEMP}/pnpm-${pnpm_version}.XXXXXX")"

  cleanup() {
    rm -rf "${staging_root}"
  }
  trap cleanup EXIT

  echo "Installing pnpm ${pnpm_version} into the persistent runner tool cache."
  npm install \
    --global \
    --prefix "${staging_root}" \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    "pnpm@${pnpm_version}"

  rm -rf "${pnpm_root}"
  mv "${staging_root}" "${pnpm_root}"
  trap - EXIT
else
  echo "Reusing pnpm ${pnpm_version} from the persistent runner tool cache."
fi

echo "${pnpm_root}/bin" >> "${GITHUB_PATH}"
echo "GEUL_PNPM_STORE_DIR=${RUNNER_TOOL_CACHE}/pnpm-store" >> "${GITHUB_ENV}"
