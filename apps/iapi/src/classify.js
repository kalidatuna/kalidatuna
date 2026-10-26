// Assigns every menu item a "kind" so the app can hide sauces and add-ons by default
// and build meals out of a main, a side and a drink. Wolt's autotranslation leaves
// some names in Georgian, so each rule also has Georgian keywords.

export const KINDS = ['main', 'combo', 'side', 'drink', 'dessert', 'extra'];

const EXTRA = /\b(sauce|dressing|ketchup|mustard|mayo(nnaise)?|topping|syrup|extra|add-?on|additional|cutlery|napkin|bag|packag\w*|toy|book|dip|container|pepper in)\b|სოუს|კეტჩუპ|მდოგვ|მაიონეზ|ტოპინგ|სიროფ|დამატებით/i;

const DRINK_CATEGORY = /drink|beverage|coffee|caf[eé]|\btea\b|სასმელ|ყავა/i;
const DRINK_NAME = /\b(coca|cola|pepsi|sprite|fanta|water|juice|lemonade|coffee|latte|cappuccino|espresso|americano|flat white|tea|mojito|red ?bull|energy drink|refresher|smoothie|cocoa|hot chocolate|mocha|macchiato|frappe|frappuccino|borjomi|nabeghlavi)\b|კოკა|ყავა|ჩაი|წყალი|ლიმონათ|წვენი|ლატე|კაპუჩინო|ესპრესო/i;

const DESSERT = /\b(desserts?|sweets?|frosty|mc ?flurry|flurry|shakes?|milkshake|pie|muffins?|cookies?|ice[- ]?cream|sundae|donuts?|doughnuts?|cakes?|brownies?|croissants?|munchkins?|cinnamon|churros?|waffles?)\b|შეიკ|ფლარი|ნაყინ|ღვეზელ|დონატ|ნამცხვარ|ტორტ|ქუქი/i;

const COMBO_NAME = /\b(combos?|sets?|meals?|menu|mc ?menu|macmeniu|happy|box|bucket|for two|family|duo|trio|deal)\b|მენიუ|სეტი|კომბო/i;
// Category names like "Chicken menu and baskets" are too broad, so categories only
// count as combos with these narrower words.
const COMBO_CATEGORY = /\b(combos?|sets?|meals?|mc ?menu|macmeniu|happy)\b|სეტ|კომბო/i;

const SIDE_NAME = /\b(fries|potato(es)?|wedges|mozzarella sticks|onion rings|hash ?browns?|coleslaw|corn)\b|ფრი|კარტოფილ/i;
const SIDE_CATEGORY = /\b(sides?|starters?|snacks?|appetizers?)\b/i;
const MAIN_NAME = /\b(mc ?nuggets?|nuggets?|wings?|strips?|tenders?|burgers?|cheeseburgers?|wraps?|sandwich(es)?|subs?|pizzas?|rolls?|shaurma|shawarma|doner|kebab|salads?|hot ?dogs?|pasta|bowl)\b|ბურგერ|პიცა|შაურმ|სენდვიჩ|როლი|ფრთ|ნაგეტს|ქათმ/i;

// item: { name, nameKa, category }
export function classifyItem({ name = '', nameKa = '', category = '' }) {
  const text = `${name} ${nameKa}`;
  const all = `${text} ${category}`;

  // Pizza menus use names like "33 cm Extra Farmer", so a pizza category wins over "extra".
  if (EXTRA.test(text) && !MAIN_NAME.test(text) && !/pizza|პიცა/i.test(category)) return 'extra';
  if (/\bsauces?\b|სოუს/i.test(category)) return 'extra';
  if (DRINK_CATEGORY.test(category) && !DESSERT.test(text)) return 'drink';
  if ((COMBO_NAME.test(text) || COMBO_CATEGORY.test(category)) && !DRINK_NAME.test(text) && !DESSERT.test(text)) return 'combo';
  if (DESSERT.test(all)) return 'dessert';
  if (DRINK_NAME.test(text)) return 'drink';
  if (SIDE_NAME.test(text) && !MAIN_NAME.test(name)) return 'side';
  if (SIDE_CATEGORY.test(category) && !MAIN_NAME.test(name)) return 'side';
  return 'main';
}
