#!/bin/bash
set -e
echo "🚀 Pushing to GitHub..."
git config --global user.email "upi24now@users.noreply.github.com"
git config --global user.name "upi24now"
git remote add github "https://upi24now:${GITHUB_TOKEN}@github.com/upi24now/bike-courier.git" 2>/dev/null \
  || git remote set-url github "https://upi24now:${GITHUB_TOKEN}@github.com/upi24now/bike-courier.git"
git push github main
echo "✅ Done! Visit: https://github.com/upi24now/bike-courier"
