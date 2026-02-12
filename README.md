# Calorie Counter Hub

A responsive multi-profile calorie tracking web app for managing calorie deficit goals.

## Features

- Multiple profile blocks (one per person or target phase)
- Maintenance + target calorie setup per profile
- Daily meal tracking with four slots:
  - Breakfast
  - Lunch
  - Snacks
  - Dinner
- Searchable food and drinks library with calories per 100g
- Add custom foods to extend the library
- Import foods in bulk via CSV (`name,category,kcalPer100g,defaultServingG`)
- Automatic daily total calculation and deficit metrics
- Interactive bar chart for daily calorie intake history
- Data persistence using browser local storage

Sample import file: `/Users/varadvikaspatil/LocalDocuments/PersonelDocs/CalorieCounter/sample-food-import.csv`

## Run

Because this is a static web app, you can open it directly:

1. Open `/Users/varadvikaspatil/LocalDocuments/PersonelDocs/CalorieCounter/index.html` in a browser.

Or run a local server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Notes

- The app ships with a broad starter food/drinks dataset.
- For full real-world coverage, keep adding custom foods as needed.
- All entries and settings are stored in local storage for this browser.

## Publish on GitHub Pages

1. Create a new empty repository on GitHub (for example: `calorie-counter-hub`).
2. In this project folder, connect and push:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

3. On GitHub open: `Settings` -> `Pages`.
4. Under `Build and deployment`, set:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/ (root)`
5. Save and wait ~1-3 minutes.
6. Your site will be live at:
   - `https://<your-username>.github.io/<repo-name>/`
