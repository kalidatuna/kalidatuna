import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyItem } from '../src/classify.js';

const cases = [
  [{ name: 'Ketchup', category: 'Sauces' }, 'extra'],
  [{ name: 'Hot cheese sauce', category: 'Fries and starters' }, 'extra'],
  [{ name: 'Additional book', category: 'Happy Mill' }, 'extra'],
  [{ name: '33 cm Extra Farmer', category: 'Pizza 33 cm - 8 slices' }, 'main'],
  [{ name: 'Coca-Cola', category: 'cold drinks' }, 'drink'],
  [{ name: 'Cappuccino', category: 'McCaffe drinks' }, 'drink'],
  [{ name: 'Sprite 330 ml', category: 'Beverages' }, 'drink'],
  [{ name: 'Big Mac McMenu', category: 'Macmeniu' }, 'combo'],
  [{ name: 'Happy Mill with a hamburger', category: 'Happy Mill' }, 'combo'],
  [{ name: 'Spicy Cheese combo', category: 'Combo Menu' }, 'combo'],
  [{ name: 'Set for two', category: 'Special offers' }, 'combo'],
  [{ name: 'Chicken wings', category: 'Chicken menu and baskets' }, 'main'],
  [{ name: 'French fries', category: 'Fries and starters' }, 'side'],
  [{ name: 'Chicken McNuggets 6 pcs.', category: 'Fries and starters' }, 'main'],
  [{ name: 'Mozzarella sticks', category: 'Sides' }, 'side'],
  [{ name: 'Frosty', category: 'Desserts' }, 'dessert'],
  [{ name: 'Glazed donut', category: 'Donuts' }, 'dessert'],
  [{ name: 'Cheeseburger', category: 'Sandwiches' }, 'main'],
  [{ name: 'Kids chicken Burger', category: 'KIDS BURGER' }, 'main'],
  [{ name: 'Kids meal Cheeseburger', category: 'Kids Meal Combos' }, 'combo'],
  [{ name: 'Pepper in container 🌶', category: 'Fries and Starters' }, 'extra'],
  [{ name: 'Blueberry Refresher', category: 'Refreshers' }, 'drink'],
  [{ name: 'Chicken burger menu', category: 'CHICKEN AND FISH BURGER MENU' }, 'combo'],
  [{ name: 'Wendys Burger', category: 'Burgers' }, 'main'],
  [{ name: 'ნესქვიკის მაკ ფლარი', category: 'Desserts' }, 'dessert'],
  [{ name: 'ჩიქენ როლის მაკმენიუ', category: "Mac's chicken" }, 'combo'],
];

for (const [item, kind] of cases) {
  test(`classifies "${item.name}" as ${kind}`, () => {
    assert.equal(classifyItem(item), kind);
  });
}
