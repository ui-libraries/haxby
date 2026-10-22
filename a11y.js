/*!
 * a11y.js — runtime accessibility enhancements for the Unnatural Networks / Haxby Project storymap.
 *
 * Load this AFTER Leaflet, jQuery and storymap.js (index.html / index2.html already do), then
 * call A11Y.enhanceMap(map, miniMap) from the storymap createMap callback (already wired up).
 *
 * What it does (see ACCESSIBILITY_CHANGES.md for the WCAG mapping):
 *   - Makes Leaflet markers keyboard-operable (Enter / Space opens text, Esc closes, focus is managed)
 *   - Gives markers, popup close buttons, the comparison slider and the layer control accessible names
 *   - Makes the "scroll down" arrow a real keyboard-operable button
 *   - Announces scene changes to screen readers (polite live region) and keeps aria-current in sync
 *   - Updates a visually hidden text description of the current map
 *   - Honours prefers-reduced-motion for Leaflet pan/zoom animation
 *   - Takes the redundant dot navigation widget out of the tab order
 *
 * Plain ES5, no dependencies other than Leaflet (optional) and jQuery (optional, mobile menu close only).
 */
(function (window, document) {
  'use strict';

  var A11Y = (window.A11Y = window.A11Y || {});
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  A11Y.prefersReducedMotion = function () {
    return !!(mq && mq.matches);
  };

  function isActivationKey(ev) {
    return ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar' || ev.keyCode === 13 || ev.keyCode === 32;
  }
  function isEscape(ev) {
    return ev.key === 'Escape' || ev.key === 'Esc' || ev.keyCode === 27;
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  /* ------------------------------------------------------------------ Leaflet patches */

  function activateMarker(marker) {
    var popup = marker.getPopup && marker.getPopup();
    if (!popup) { return; }
    if (marker.isPopupOpen && marker.isPopupOpen()) {
      marker.closePopup();
      return;
    }
    marker.openPopup();
    // Move focus into the text so screen readers read it and it can be scrolled with the keyboard.
    setTimeout(function () {
      if (popup._contentNode) { popup._contentNode.focus(); }
    }, 0);
  }

  function decorateMarker(marker) {
    var el = marker._icon;
    var label = marker.options && marker.options.a11yLabel;
    if (!el || !label) { return; }

    // Leaflet writes alt="" on marker images; a focusable control needs a real name.
    el.setAttribute('alt', label);
    el.setAttribute('aria-label', label);
    el.setAttribute('role', 'button');
    if (marker.getPopup && marker.getPopup()) { el.setAttribute('aria-haspopup', 'true'); }

    if (el.__a11yBound) { return; }
    el.__a11yBound = true;
    el.addEventListener('keydown', function (ev) {
      if (isActivationKey(ev)) {
        ev.preventDefault(); // stops Leaflet's own keypress->click from toggling twice
        ev.stopPropagation();
        activateMarker(marker);
      }
    });
  }

  function patchLeaflet() {
    var L = window.L;
    if (!L || !L.Map || !L.Marker || L.__a11yPatched) { return; }
    L.__a11yPatched = true;

    // Every time a marker (re)builds its <img> -- including after setIcon() on hover -- decorate it.
    var origInitIcon = L.Marker.prototype._initIcon;
    L.Marker.prototype._initIcon = function () {
      origInitIcon.apply(this, arguments);
      decorateMarker(this);
    };

    // prefers-reduced-motion: no animated pan / zoom / fly
    if (A11Y.prefersReducedMotion()) {
      var origSetView = L.Map.prototype.setView;
      L.Map.prototype.setView = function (center, zoom, options) {
        return origSetView.call(this, center, zoom, L.extend({}, options || {}, { animate: false }));
      };
      L.Map.prototype.flyTo = function (center, zoom) {
        return this.setView(center, zoom === undefined ? this.getZoom() : zoom, { animate: false });
      };
    }
  }

  /* ------------------------------------------------------------------ map-level enhancements */

  function labelControls(root) {
    root = root || document;

    // Comparison slider (leaflet-side-by-side): native <input type=range> with no name.
    var ranges = root.querySelectorAll('.leaflet-sbs-range');
    Array.prototype.forEach.call(ranges, function (r) {
      if (r.getAttribute('data-a11y')) { return; }
      r.setAttribute('data-a11y', '1');
      r.setAttribute('aria-label', 'Map comparison slider. Left and right arrow keys move the divider between the two maps.');
      // step="any" makes the arrow keys jump the full range in some browsers; give it 50 steps.
      var min = parseFloat(r.min) || 0;
      var max = parseFloat(r.max);
      if (isNaN(max)) { max = 1; }
      if (!r.getAttribute('step') || r.getAttribute('step') === 'any') {
        r.setAttribute('step', String((max - min) / 50));
      }
      var describe = function () {
        var pct = Math.round(((parseFloat(r.value) - min) / (max - min)) * 100);
        r.setAttribute('aria-valuetext', 'Divider ' + pct + ' percent from the left edge');
      };
      r.addEventListener('input', describe);
      r.addEventListener('change', describe);
      describe();
    });
    Array.prototype.forEach.call(root.querySelectorAll('.leaflet-sbs-divider'), function (d) {
      d.setAttribute('aria-hidden', 'true');
    });

    // Layer control (tree of map comparisons)
    Array.prototype.forEach.call(root.querySelectorAll('.leaflet-control-layers'), function (c) {
      if (!c.getAttribute('role')) { c.setAttribute('role', 'group'); }
      if (!c.getAttribute('aria-label')) { c.setAttribute('aria-label', 'Choose which two maps to compare'); }
    });
  }

  A11Y.enhanceMap = function (map, miniMap) {
    if (!map || !map.getContainer) { return; }
    var container = map.getContainer();
    if (!container.getAttribute('role')) { container.setAttribute('role', 'region'); }
    if (!container.getAttribute('aria-label')) { container.setAttribute('aria-label', 'Interactive map'); }

    // ---- popups -------------------------------------------------------------------------
    var openPopup = null;
    map.on('popupopen', function (e) {
      openPopup = e.popup;
      var content = e.popup._contentNode;
      var root = e.popup._container;
      if (content) {
        // The popup text box scrolls (max-height + overflow) so it must be keyboard-reachable.
        content.setAttribute('tabindex', '0');
        content.setAttribute('role', 'group');
        content.setAttribute('aria-label', 'Entry text. Press Escape to close.');
      }
      var close = root && root.querySelector('.leaflet-popup-close-button');
      if (close) {
        close.setAttribute('role', 'button');
        close.setAttribute('aria-label', 'Close entry text');
        close.setAttribute('title', 'Close');
      }
    });
    map.on('popupclose', function (e) {
      var src = e.popup._source;
      var ae = document.activeElement;
      openPopup = null;
      // Return focus to the marker the text belongs to (WCAG 2.4.3) if focus was lost with the popup.
      if (src && src._icon && (ae === document.body || ae == null || (e.popup._container && e.popup._container.contains(ae)))) {
        try { src._icon.focus(); } catch (err) { /* ignore */ }
      }
    });
    // Escape closes the popup (1.4.13 "dismissible"), whichever element inside the map has focus.
    document.addEventListener('keydown', function (ev) {
      if (!isEscape(ev) || !openPopup) { return; }
      if (container.contains(document.activeElement)) { map.closePopup(openPopup); }
    });

    // ---- mini globe: decorative locator, not interactive ---------------------------------
    if (miniMap && typeof miniMap.getContainer === 'function') {
      var mc = miniMap.getContainer();
      if (mc && !mc.querySelector('a[href], button, input, select, textarea, [tabindex]')) {
        mc.setAttribute('role', 'img');
        mc.setAttribute('aria-label', 'Small globe showing the part of the world currently displayed on the map');
      }
    }

    // ---- controls that Leaflet / plugins add and remove at runtime ----------------------
    var cc = container.querySelector('.leaflet-control-container');
    if (cc && window.MutationObserver) {
      var relabel = debounce(function () { labelControls(cc); }, 100);
      new MutationObserver(relabel).observe(cc, { childList: true, subtree: true });
    }
    labelControls(container);
  };

  /* ------------------------------------------------------------------ page-level enhancements */

  function initArrow() {
    var arrow = document.querySelector('.arrow-down');
    if (!arrow) { return; }
    if (!arrow.getAttribute('role')) { arrow.setAttribute('role', 'button'); }
    if (!arrow.getAttribute('tabindex')) { arrow.setAttribute('tabindex', '0'); }
    if (!arrow.getAttribute('aria-label')) { arrow.setAttribute('aria-label', 'Scroll to next scene'); }
    arrow.addEventListener('keydown', function (ev) {
      if (isActivationKey(ev)) {
        ev.preventDefault();
        arrow.click(); // runs whatever click handler storymap.js attached
      }
    });
  }

  // The dot widget generated by storymap.js duplicates the navbar menus and has 60 stops: keep it
  // for mouse users but out of the keyboard tab order (the wrapper is aria-hidden in the HTML).
  function initNavWidget() {
    var widget = document.querySelector('.navwidget');
    if (!widget) { return; }
    var fix = function () {
      Array.prototype.forEach.call(widget.querySelectorAll('a, button, [tabindex]'), function (el) {
        el.setAttribute('tabindex', '-1');
      });
    };
    fix();
    if (window.MutationObserver) {
      new MutationObserver(debounce(fix, 50)).observe(widget, { childList: true, subtree: true });
    }
  }

  function initNavLinks() {
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#scene-"]') : null;
      if (!a) { return; }
      var id = a.getAttribute('href').slice(1);
      // Close the collapsed (mobile) menu after choosing an item.
      if (window.jQuery) {
        var $c = window.jQuery('.navbar-collapse.in');
        if ($c.length) { $c.collapse('hide'); }
      }
      // Move keyboard / screen-reader focus to the scene that was jumped to.
      setTimeout(function () {
        var target = document.getElementById(id);
        if (target) {
          try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
        }
      }, 0);
    });
  }

  function initScenes() {
    var sections = Array.prototype.slice.call(document.querySelectorAll('section[data-scene]'));
    if (!sections.length) { return; }
    var status = document.getElementById('a11y-status');
    var mapDesc = document.getElementById('map-description');
    var links = Array.prototype.slice.call(document.querySelectorAll('a[href^="#scene-"]'));
    var current = null;
    var firstUpdate = true;
    var announceTimer = null;

    function titleOf(section) {
      var h = section.querySelector('.scene-title, h1, h2, h3');
      return h ? h.textContent.replace(/\s+/g, ' ').trim() : section.getAttribute('data-scene');
    }

    function update() {
      var s = null;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].classList.contains('viewing')) { s = sections[i]; break; }
      }
      if (!s || s === current) { return; }
      current = s;

      var key = s.getAttribute('data-scene');
      links.forEach(function (a) {
        if (a.getAttribute('href') === '#scene-' + key) { a.setAttribute('aria-current', 'location'); }
        else { a.removeAttribute('aria-current'); }
      });

      var desc = s.getAttribute('data-map-description') || '';
      if (mapDesc) { mapDesc.textContent = desc; }

      // Don't announce the scene that is showing on page load; debounce so fast scrolling
      // through many scenes produces one announcement, not dozens.
      if (firstUpdate) { firstUpdate = false; return; }
      clearTimeout(announceTimer);
      announceTimer = setTimeout(function () {
        if (!status) { return; }
        status.textContent = '';
        setTimeout(function () {
          status.textContent = 'Map updated. Now showing: ' + titleOf(s) + '. ' + desc;
        }, 50);
      }, 900);
    }

    if (window.MutationObserver) {
      var mo = new MutationObserver(update);
      sections.forEach(function (s) { mo.observe(s, { attributes: true, attributeFilter: ['class'] }); });
    }
    update();
  }

  function ready(fn) {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn); }
    else { fn(); }
  }

  patchLeaflet();
  ready(function () {
    patchLeaflet(); // in case Leaflet loaded after this script
    initArrow();
    initNavWidget();
    initNavLinks();
    initScenes();
  });
})(window, document);
