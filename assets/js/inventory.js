var Inventory = {
  isEnabled: $.cookie('inventory-enabled') == '1',
  isPopupEnabled: $.cookie('inventory-popups-enabled') == '1',
  isMenuUpdateEnabled: $.cookie('inventory-menu-update-enabled') == '1',
  stackSize: parseInt($.cookie('inventory-stack')) ? parseInt($.cookie('inventory-stack')) : 10,
  resetButtonUpdatesInventory: $.cookie('reset-updates-inventory-enabled') == '1',
  resetInventoryDaily: $.cookie('reset-inventory-daily') == '1',
  items: {},
  changedItems: [],
  categories: {},
  highlightLowAmountItems: $.cookie('highlight_low_amount_items') == '1',
  highlightStyles: { STATIC_RECOMMENDED: 0, STATIC_DEFAULT: 1, ANIMATED_RECOMMENDED: 2, ANIMATED_DEFAULT: 3 },
  highlightStyle: !isNaN(parseInt($.cookie('highlight_style'))) ? parseInt($.cookie('highlight_style')) : 2,

  init: function () {
    if ($.cookie('inventory-popups-enabled') === undefined) {
      Inventory.isPopupEnabled = true;
      $.cookie('inventory-popups-enabled', '1', { expires: 999 });
    }

    if ($.cookie('inventory-menu-update-enabled') === undefined) {
      Inventory.isMenuUpdateEnabled = true;
      $.cookie('inventory-menu-update-enabled', '1', { expires: 999 });
    }

    if ($.cookie('reset-updates-inventory-enabled') === undefined) {
      Inventory.resetButtonUpdatesInventory = false;
      $.cookie('reset-updates-inventory-enabled', '0', { expires: 999 });
    }

    if ($.cookie('reset-inventory-daily') === undefined) {
      Inventory.resetInventoryDaily = false;
      $.cookie('reset-inventory-daily', '0', { expires: 999 });
    }

    if ($.cookie('highlight_low_amount_items') === undefined) {
      Inventory.highlightLowAmountItems = false;
      $.cookie('highlight_low_amount_items', '0', { expires: 999 });
    }

    if ($.cookie('highlight_style') === undefined) {
      Inventory.highlightStyle = Inventory.highlightStyles.ANIMATED_RECOMMENDED;
      $.cookie('highlight_style', Inventory.highlightStyles.ANIMATED_RECOMMENDED, { expires: 999 });
    }

    $('#enable-inventory').prop("checked", Inventory.isEnabled);
    $('#enable-inventory-popups').prop("checked", Inventory.isPopupEnabled);
    $('#enable-inventory-menu-update').prop("checked", Inventory.isMenuUpdateEnabled);
    $('#reset-collection-updates-inventory').prop("checked", Inventory.resetButtonUpdatesInventory);
    $('#reset-inventory-daily').prop("checked", Inventory.resetInventoryDaily);
    $('#highlight_low_amount_items').prop("checked", Inventory.highlightLowAmountItems);
    $('#highlight_style').val(Inventory.highlightStyle);

    $('#inventory-stack').val(Inventory.stackSize);

    $('#inventory-container').toggleClass("opened", Inventory.isEnabled);
  },

  load: function () {
    Inventory.items = JSON.parse(localStorage.getItem("inventory"));
    if (Inventory.items === null) Inventory.items = {};

    $.each(MapBase.markers, function (key, marker) {
      if (marker.category == 'random') return;
      marker.amount = Inventory.items[marker.text.replace(/_\d/, '')];
    });

    ItemsValue.load();
  },

  save: function () {
    $.each(MapBase.markers, function (key, marker) {
      if (marker.category == 'random') return;
      Inventory.items[marker.text.replace(/_\d/, '')] = marker.amount;
    });

    localStorage.setItem("inventory", JSON.stringify(Inventory.items));

    ItemsValue.load();
    Inventory.updateLowAmountItems();
  },

  getMovingAverage: function (currentAvg, newVal, numElements) {
    return (currentAvg * numElements + newVal) / (numElements + 1.0);
  },

  updateLowAmountItems: function () {
    if (!Inventory.isEnabled || !Inventory.highlightLowAmountItems) {
      return;
    }

    // reset category values
    if (Inventory.categories == undefined) {
      Inventory.categories = {};
    }

    var changedCategories = [];

    if (this.changedItems.length == 0) {
      this.changedItems = Object.keys(Inventory.items);
    }

    // build a unique list of categories whose item amounts have changed
    this.changedItems.forEach(itemName => {
      var category = itemName.split("_")[0];
      if (changedCategories.indexOf(category) == -1) {
        changedCategories.push(category);
      }
    });

    // walk through all categories and update the corresponding markers
    changedCategories.forEach(category => {
      Inventory.categories[category] = { max: 0, min: 0, avg: 0.0, numElements: 0 };
      var itemsInThisCategory = Object.keys(Inventory.items).filter(itemName => itemName.startsWith(category));

      itemsInThisCategory.forEach(itemName => {
        var itemAmount = Inventory.items[itemName];

        // compute all category values again
        Inventory.categories[category] = {
          max: Math.max(Inventory.categories[category].max, itemAmount),
          min: Math.min(Inventory.categories[category].min, itemAmount),
          avg: Inventory.getMovingAverage(Inventory.categories[category].avg, parseFloat(itemAmount), Inventory.categories[category].numElements),
          numElements: Inventory.categories[category].numElements + 1
        };
      });

      if (category == "random") return;

      // since items with amount 0 have not been considered before: adjust the average amount with the missing "0" values
      var numItemsInCategory = ItemsValue.collectionsLength.find(c => c[0] == category)[1];
      if (Inventory.categories[category].numElements < numItemsInCategory) {
        Inventory.categories[category].avg = (Inventory.categories[category].avg * Inventory.categories[category].numElements) / numItemsInCategory;
        Inventory.categories[category].numElements = numItemsInCategory;
      }
      // update the category markers
      Inventory.updateLowItemMarkersForCategory(category);
    });

    // clear the change items data
    this.changedItems = [];
  },

  // update the markers of a specified item category
  updateLowItemMarkersForCategory: function (category) {
    // remove all highlight classes at first
    $(`[data-marker*=${category}] > img.marker-contour`).removeClass(function (index, className) {
      return (className.match(/highlight-low-amount-items-\S+/gm) || []).join(' ');
    });
    $(`[data-marker*=${category}] > img.marker-contour`).css('--animation-target-opacity', 0.0);
    $(`[data-marker*=${category}] > img.marker-contour`).css("opacity", 0.0);

    if (Inventory.categories[category] == undefined) {
      Inventory.categories[category] = { min: 0, max: 0, avg: 0, numElements: 0 };
    }

    // get all markers which should be highlighted
    var markers = MapBase.markers.filter(_m => {
      return _m.text.startsWith(category) &&
        enabledCategories.includes(_m.category) &&
        _m.day == Cycles.categories[_m.category];
    });

    // for each marker: calculate the value used for coloring and add/remove the appropriate css class
    markers.map(_m => {
      // Set the correct marker colors depending on the map background.
      // Do this only affected collectible item markers and exclude, e.g. fast travel points or madam nazar
      Inventory.updateMarkerSources(_m);

      // further highlighting should only be done for enabled markers
      if (!_m.canCollect || _m.isCollected) {
        return;
      }

      var weight = (Inventory.categories[category].avg - parseFloat(_m.amount)) / Inventory.stackSize;
      weight = Math.max(weight, 0.0);

      var scaledWeight = Math.min(weight * 2.4, 1.0);

      // set new highlight-low-amount-items class based on current value
      if (weight < 0.02) {
        // no highlights
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('opacity', 0.0);
      }
      else if ((weight < 0.3) || (Inventory.highlightStyle < Inventory.highlightStyles.ANIMATED_RECOMMENDED)) { // just static highlights for small differences or if animation is disabled
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('opacity', scaledWeight);
      }
      else { // animated or static highlights for larger differences according to user settings
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).css('--animation-target-opacity', scaledWeight);
        $(`[data-marker=${_m.text || _m.subdata}] > img.marker-contour`).addClass(`highlight-low-amount-items-animated`);
      }
    });
  },

  updateMarkerSources: function (marker) {
    var markerBackgroundColor = MapBase.getIconColor(marker);
    var markerContourColor = MapBase.getContourColor(markerBackgroundColor);

    var markerSrc = `./assets/images/icons/marker_${markerBackgroundColor}.png?v=${nocache}`;
    var markerContourSrc = `./assets/images/icons/contours/contour_marker_${markerContourColor}.png?v=${nocache}`;

    // update the contour color
    $(`[data-marker=${marker.text || marker.subdata}] > img.marker-contour`).attr('src', markerContourSrc);
    $(`[data-marker=${marker.text || marker.subdata}] > img.background`).attr('src', markerSrc);
  },

  changeMarkerAmount: function (name, amount, skipInventory = false) {
    var marker = MapBase.markers.filter(marker => {
      return (marker.text == name || marker.subdata == name);
    });

    Inventory.changedItems.push(marker[0].text);

    $.each(marker, function (key, marker) {
      if (!skipInventory || skipInventory && Inventory.isMenuUpdateEnabled) {
        marker.amount = parseInt(marker.amount) + amount;

        if (marker.amount < 0)
          marker.amount = 0;
      }

      if (!Inventory.isEnabled) return;

      marker.canCollect = marker.amount < Inventory.stackSize && !marker.isCollected;

      var small = $(`small[data-item=${name}]`).text(marker.amount);
      var cntnm = $(`[data-type=${name}] .counter-number`).text(marker.amount);

      small.toggleClass('text-danger', marker.amount >= Inventory.stackSize);
      cntnm.toggleClass('text-danger', marker.amount >= Inventory.stackSize);

      // If the category is disabled, no needs to update popup
      if (Settings.isPopupsEnabled && marker.day == Cycles.categories[marker.category] && Layers.itemMarkersLayer.getLayerById(marker.text) != null)
        Layers.itemMarkersLayer.getLayerById(marker.text)._popup.setContent(MapBase.updateMarkerContent(marker));

      if ((marker.isCollected || (Inventory.isEnabled && marker.amount >= Inventory.stackSize)) && marker.day == Cycles.categories[marker.category]) {
        $(`[data-marker=${marker.text}]`).css('opacity', Settings.markerOpacity / 3);
        $(`[data-type=${marker.subdata || marker.text}]`).addClass('disabled');
      }
      else if (marker.day == Cycles.categories[marker.category]) {
        $(`[data-marker=${marker.text}]`).css('opacity', Settings.markerOpacity);
        $(`[data-type=${marker.subdata || marker.text}]`).removeClass('disabled');
      }

      MapBase.toggleCollectibleMenu(marker.day, marker.text, marker.subdata, marker.category);
      Menu.refreshCollectionCounter(marker.category);
    });

    if ($("#routes").val() == 1)
      Routes.drawLines();

    Inventory.save();
    Menu.refreshItemsCounter();
    Menu.refreshWeeklyItems();
  }
};