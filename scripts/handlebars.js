Handlebars.registerHelper('isOne', function (value) {
  return value === 1;
});

Handlebars.registerHelper('isTwo', function (value) {
  return value === 2;
});

Handlebars.registerHelper('isThreePlus', function (value) {
  return value > 2;
});

// If the length of the input array is more than one, there is a tie (whether in mode or for a given statistic like highest mean)
Handlebars.registerHelper('isTie', function (value) {
  return value.length > 1;
});

// To check if the current item being iterated over is the last item in the array
Handlebars.registerHelper('isLast', function (index, length) {
  if (length - index === 1) {
    return true
  }
});

// To check if the current item being iterated over is the second last item in the array
Handlebars.registerHelper('isSecondLast', function (index, length) {
  if (length - index === 2) {
    return true
  }
});
