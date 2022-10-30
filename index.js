const axios = require("axios");
const lodash = require("lodash");
const { JSDOM } = require("jsdom");

async function getDom(propertyId) {
  const dom = await axios.get(`https://www2.kv.ee/en/${propertyId}`);
  return dom.data.content;
}

async function getProperties(propertySearch) {
  let properties = [];
  for (id of propertySearch.propertyIds) {
    try {
      const htmlContent = await getDom(id);
      properties.push(getFeaturesFromProperty(htmlContent, id));
    } catch (err) {
      console.log(err.message);
    }
  }
  return properties;
}

function getFeaturesFromProperty(propertyData, id) {
  const dom = new JSDOM(propertyData);

  // property price
  const price = dom.window.document
    .getElementsByClassName("price-outer")
    .item(0)
    .children.item(0)
    .childNodes[0].textContent.trim();

  const title = dom.window.document
    .getElementsByTagName("h1")
    .item(0).textContent;

  // location
  const [direction, city, parish, county] = title
    .match(/\s-\s(.*)$/)[1]
    .split(",")
    .map((elem) => elem.trim());

  const table = dom.window.document
    .getElementsByClassName("table-lined")
    .item(0);

  // property type
  const [property, type] = table.rows[0].textContent.trim().split("for");
  const propertyType = {
    property: property.trim(),
    deal: type.trim(),
  };

  // main features
  const features = {};
  for (let i = 1; i < table.rows.length; i++) {
    let key = lodash.camelCase(table.rows[i].cells[0].textContent.trim());

    let value = table.rows[i].cells[1];
    if (value) features[key] = value.textContent.trim();
  }

  // additional information
  const info = dom.window.document
    .getElementsByClassName("description")
    .item(0)
    .getElementsByTagName("p")
    .item(0);
  let additionalInfo = {};
  for (let i = 0; i < info.getElementsByTagName("strong").length; i++) {
    let key = getKey(info, i);
    let value = getValue(info, i);
    additionalInfo[key] = value;
  }

  return {
    id,
    price,
    propertyType,
    location: { direction, city, parish, county },
    features,
    additionalInfo,
  };
}

function getValue(info, i) {
  const isLastElement = i + 1 == info.getElementsByTagName("strong").length;
  const value = info.textContent.split(":")[i + 1].trim();
  return isLastElement ? value : sanitizeValue(value, info, i);
}

function sanitizeValue(value, info, i) {
  const strToRemove = info
    .getElementsByTagName("strong")
    .item(i + 1)
    .textContent.trim()
    .split(":")[0]
    .trim();
  return value.split(strToRemove)[0].trim();
}

function getKey(info, i) {
  return lodash.camelCase(
    info.getElementsByTagName("strong").item(i).textContent.trim().split(":")[0]
  );
}

const propertySearch = {
  provider: "kv",
  // out of range: 3216791
  // no rooms addes: 3474362, 3354145
  // no conditions added 3466200
  propertyIds: [
    3435688, 3473089, 3475429, 3336883, 3471750, 3446645, 3474370, 3480331,
    3474785, 3474656, 3216611, 3432531, 3475839, 2928423, 3462587, 3482030,
    3382191, 3474362, 3354145, 3466200, 3216791,
  ],
  limit: 100,
  page: 1,
};
function getPriceRange(properties) {
  let copy = properties.slice();
  let min = {
    price: getPrice(properties[0].price),
    id: properties[0].id,
    index: 0,
  };
  let max = min;
  copy.shift();

  copy.forEach(({ price, id }, index) => {
    currentPrice = getPrice(price);
    min =
      currentPrice < min.price
        ? { price: currentPrice, id, index: index + 1 }
        : min;
    max =
      currentPrice > max.price
        ? { price: currentPrice, id, index: index + 1 }
        : max;
  });
  return { min, max };
}

function getPrice(priceStr) {
  return Number(
    priceStr
      .slice(0, priceStr.length - 2)
      .split(/\s/)
      .join("")
  );
}

function calculatePoints(
  properties,
  { rooms, builtInYear, condition, numberOfFloors = 1, totalArea }
) {
  const { min, max } = getPriceRange(properties);
  const minProperty = properties[min.index];
  const maxProperty = properties[max.index];

  const roomPoints = calculatePoint({
    feature: rooms,
    min: minProperty.features.rooms,
    max: maxProperty.features.rooms,
    points: 20,
  });

  /*
  const bedroomPoints = calculatePoint({
    feature: bedrooms,
    min: minProperty.features.bedrooms,
    max: maxProperty.features.bedrooms,
    points: 10,
  });
  
  const groundAreaPoints = calculatePoint({
    feature: getArea(groundArea),
    min: getArea(minProperty.features.groundArea),
    max: getArea(maxProperty.features.groundArea),
    points: 1,
  });
  */

  const builtInYearPoints = calculateYearPoint(properties, builtInYear);

  const totalAreaPoints = calculatePoint({
    feature: getArea(totalArea),
    min: getArea(minProperty.features.totalArea),
    max: getArea(maxProperty.features.totalArea),
    points: 1,
  });

  const conditionPoints = calculateConditionPoint(condition);

  return (
    roomPoints +
    builtInYearPoints +
    totalAreaPoints * numberOfFloors +
    conditionPoints
  );

  function getArea(area) {
    return area ? area.split("m")[0].trim() : -100;
    // return area && area.split("m")[0].trim();
  }

  function calculatePoint({ feature = 0, min = 0, max = 0, points }) {
    const sign = Math.sign(Number(max) - Number(min));
    return sign * points * Number(feature);
  }

  function calculateConditionPoint(feature) {
    const CONDITIONS = {
      needsRenovating: -150,
      sanitaryRenovationNeeded: -70,
      development: 10,
      ready: 20,
      satisfactory: 50,
      goodCondition: 80,
      sanitaryRenovationDone: 100,
      renovated: 150,
      allBrandNew: 200,
    };
    return CONDITIONS[lodash.camelCase(feature)] || 0;
  }

  function calculateYearPoint(properties, builtInYear) {
    // if (!builtInYear) return 0;
    const minBuiltInYear = Math.min(
      ...properties.map((p) => Number(p.features.builtInYear)).filter((p) => p)
    );
    return Number(builtInYear) - minBuiltInYear;
  }
}

function sortPropertiesByPoints(properties) {
  return properties
    .map(({ id, price, features }) => ({
      id,
      point: calculatePoints(properties, features),
      price,
    }))
    .sort((a, b) => {
      if (a.point < b.point) return -1;
      if (a.point > b.point) return 1;
      return 0;
    });
}

function getPropertyPrice(properties, newProperty) {
  const point = calculatePoints(properties, newProperty);
  const allPoints = sortPropertiesByPoints(properties);
  const maxPoint = allPoints[allPoints.length - 1].price;
  const minPoint = allPoints[0].price;
  if (point > maxPoint) {
    // si es mayor que el maximo
    return (point - maxPoint) / 2 + maxPoint;
  } else if (point < minPoint) {
    // si hay uno menor que el minimo
    return (minPoint - point) / 2 + point;
  } else if (allPoints.map((p) => p.point).includes(point)) {
    // si es exactamente uno de los valores ya existentes
    return allPoints.find((p) => p.point === point).price;
  } else {
    let find = false;
    let i = 0;
    while (!find) {
      find = allPoints[i].price <= point && point <= allPoints[i + 1].price;
      i = !find ? i + 1 : i;
    }
    return (
      (allPoints[i + 1].price - allPoints[i].price) / 2 + allPoints[i].price
    );
  }
}

getProperties(propertySearch)
  .then((properties) => console.log(sortPropertiesByPoints(properties)))
  .catch((err) => console.log(err));
