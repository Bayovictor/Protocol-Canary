/* Page behaviour for the static report viewer (CF-08-A, CF-08-G).
 *
 * Report text is only ever placed into the page with `textContent`. The
 * file is read locally and never sent anywhere; the page's CSP forbids
 * network requests. The only thing stored is the theme preference.
 */
(function () {
  "use strict";

  var V = self.CanaryViewer;
  var THEME_KEY = V.STORAGE_PREFIX + "theme";

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    el(id).textContent = text;
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fact(list, label, value) {
    var term = document.createElement("dt");
    term.textContent = label;
    var detail = document.createElement("dd");
    detail.textContent = value;
    list.appendChild(term);
    list.appendChild(detail);
  }

  /* The protocol the run observed, wherever the report carries it: the
   * schema nests it under `network`, but a top-level `observedProtocol` is
   * accepted too. `null` means "not observed", which is not a mismatch. */
  function observedProtocolOf(report) {
    var network = report.network;
    if (network && typeof network.observedProtocol === "number") {
      return network.observedProtocol;
    }
    if (typeof report.observedProtocol === "number") {
      return report.observedProtocol;
    }
    return null;
  }

  /* A mismatch between the target and the observed protocol is the one
   * finding that invalidates the whole report, so it gets its own alert
   * banner at the top rather than a line in the warnings list. Reports that
   * match, or that never observed a protocol (offline run, transport error),
   * leave the banner hidden — no banner, no undefined, no throw. */
  function showMismatchBanner(report) {
    var banner = el("protocol-mismatch");
    var observed = observedProtocolOf(report);
    var target = report.targetProtocol;
    if (observed === null || typeof target !== "number" || observed === target) {
      banner.hidden = true;
      banner.textContent = "";
      return;
    }
    banner.textContent =
      "Protocol Mismatch Warning: Target protocol (" + target +
      ") differs from network observed protocol (" + observed + ").";
    banner.hidden = false;
  }

  function showInvalid(reason) {
    el("protocol-mismatch").hidden = true;
    el("protocol-mismatch").textContent = "";
    el("result").hidden = false;
    el("result").setAttribute("data-state", "invalid");
    setText("heading", V.heading(null, null));
    setText("status-line", "");
    setText("invalid-reason", reason);
    el("invalid-reason").hidden = false;
    el("facts").hidden = true;
    el("warnings").hidden = true;
  }

  function showReport(report) {
    var counts = V.deriveCounts(report);
    var warnings = [];
    var mismatched = V.countMismatches(report, counts);
    if (mismatched.length > 0) {
      warnings.push(
        "The report's stated counts disagree with its results for: " +
          mismatched.join(", ") + ". The counts shown are derived from the results."
      );
    }
    var network = report.network || null;

    el("result").hidden = false;
    el("result").setAttribute("data-state", report.status);
    /* After the result section is visible, so the alert region is announced. */
    showMismatchBanner(report);
    setText("heading", V.heading(report, counts));
    el("invalid-reason").hidden = true;
    setText("status-line", "Report status: " + report.status);

    var list = el("facts");
    clearChildren(list);
    list.hidden = false;
    fact(list, "Project", report.project.name + " (" + report.project.type + ")");
    fact(list, "Target protocol", String(report.targetProtocol));
    if (network && typeof network.name === "string") {
      fact(list, "Network", network.name +
        (typeof network.observedProtocol === "number" ? ", observed protocol " + network.observedProtocol : ""));
    }
    fact(list, "Tool version", report.toolVersion);
    fact(list, "Executed", String(counts.total));
    fact(list, "Passed", String(counts.passed));
    fact(list, "Warnings", String(counts.warnings));
    fact(list, "Failed", String(counts.failed));
    fact(list, "Errors", String(counts.errors));
    fact(list, "Skipped", String(counts.skipped));
    fact(list, "Verification", "no verification information");

    var box = el("warnings");
    clearChildren(box);
    box.hidden = warnings.length === 0;
    warnings.forEach(function (message) {
      var item = document.createElement("li");
      item.textContent = message;
      box.appendChild(item);
    });
  }

  function loadFile(file) {
    var problem = V.checkSize(file.size);
    if (problem) {
      showInvalid(problem);
      return;
    }
    file.text().then(function (text) {
      var parsed = V.parseReport(text);
      if (parsed.ok) showReport(parsed.report);
      else showInvalid(parsed.reason);
    }, function () {
      showInvalid("the file could not be read");
    });
  }

  // ---------------------------------------------------------------
  // The two-report comparison view (CF-08 section 2.4)
  // ---------------------------------------------------------------

  /* Each side holds its validated report or its refusal reason. Loading a
   * side re-runs the comparison only when both sides hold validated
   * reports; refusal is never replaced by a comparison that would label an
   * incomparable pair as compared. */
  var sides = {
    baseline: { report: null, reason: null },
    current: { report: null, reason: null },
  };

  function describeSide(name, slot) {
    if (slot.report === null && slot.reason === null) return name + ": no file loaded yet.";
    if (slot.report === null) return name + ": " + slot.reason;
    return (
      name +
      ": loaded. Target protocol " + slot.report.targetProtocol +
      ", status " + slot.report.status + "."
    );
  }

  function hideComparisonPanels() {
    el("compare-ineligible").hidden = true;
    el("compare-ineligible").textContent = "";
    el("compare-verdict").hidden = true;
    setText("compare-verdict", "");
    setText("compare-summary", "");
    el("compare-table").hidden = true;
    clearChildren(el("compare-body"));
    el("compare-result").hidden = true;
    el("compare-result").removeAttribute("data-verdict");
  }

  function showIneligible(reason) {
    hideComparisonPanels();
    el("compare-result").hidden = false;
    var banner = el("compare-ineligible");
    banner.textContent = "These reports are not compared: " + reason;
    banner.hidden = false;
  }

  function showComparison(comparison) {
    el("compare-ineligible").hidden = true;
    el("compare-ineligible").textContent = "";
    el("compare-result").hidden = false;
    el("compare-result").setAttribute("data-verdict", comparison.verdict);

    var verdict = el("compare-verdict");
    verdict.textContent = V.verdictHeading(comparison.verdict);
    verdict.hidden = false;

    var summary = comparison.summary;
    var notes = [
      summary.regressed + " regressed",
      summary.resolved + " resolved",
      summary.added + " added",
      summary.removed + " removed",
      summary.unchanged + " unchanged",
      "out of " + comparison.entries.length + " checks",
      summary.missing + " lost coverage",
    ].join(", ") + ".";
    if (comparison.emptyBaseline) {
      notes += " The baseline ran no checks.";
    }
    if (comparison.emptyCurrent) {
      notes += " The current run ran no checks.";
    }
    if (comparison.observedProtocolChanged) {
      notes += " The network observed protocol changed between runs.";
    }
    if (comparison.fixturePackChanged === true) {
      notes += " The fixture pack changed between runs.";
    } else if (comparison.fixturePackChanged === null) {
      notes += " The fixture pack could not be compared between runs.";
    }
    setText("compare-summary", notes);

    var body = el("compare-body");
    clearChildren(body);
    comparison.entries.forEach(function (entry) {
      var row = document.createElement("tr");

      var surface = document.createElement("td");
      surface.textContent = entry.surface;
      row.appendChild(surface);

      var check = document.createElement("td");
      check.textContent = entry.id;
      row.appendChild(check);

      var before = document.createElement("td");
      before.textContent = entry.from;
      row.appendChild(before);

      var after = document.createElement("td");
      after.textContent = entry.to;
      row.appendChild(after);

      var outcome = document.createElement("td");
      outcome.setAttribute("data-classification", entry.classification);
      outcome.textContent = entry.regression
        ? entry.classification + " — counts as a regression"
        : entry.classification;
      row.appendChild(outcome);

      body.appendChild(row);
    });
    el("compare-table").hidden = false;
  }

  function refreshComparison() {
    var baseline = sides.baseline;
    var current = sides.current;
    // An unloaded or refused side keeps the old comparison visible but
    // never invents one: the state line says what is missing.
    setText(
      "compare-status",
      [describeSide("Baseline", baseline), describeSide("Current", current)].join(" ")
    );
    el("compare-status").hidden = false;
    if (baseline.report === null || current.report === null) {
      hideComparisonPanels();
      return;
    }
    var outcome = V.compareReports(baseline.report, current.report);
    if (outcome.ok) {
      showComparison(outcome.comparison);
    } else {
      showIneligible(outcome.reason);
    }
  }

  function loadSide(slotName, file) {
    var slot = sides[slotName];
    var problem = V.checkSize(file.size);
    if (problem) {
      slot.report = null;
      slot.reason = problem;
      refreshComparison();
      return;
    }
    file.text().then(function (text) {
      var parsed = V.parseReport(text);
      if (parsed.ok) {
        slot.report = parsed.report;
        slot.reason = null;
      } else {
        slot.report = null;
        slot.reason = "the report was refused: " + parsed.reason;
      }
      refreshComparison();
    }, function () {
      slot.report = null;
      slot.reason = "the file could not be read";
      refreshComparison();
    });
  }

  /* Shared drag-and-drop activation for one drop zone plus its input. */
  function attachFilePicker(drop, input, onFile) {
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) onFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.setAttribute("data-active", "true");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.removeAttribute("data-active");
      });
    });
    drop.addEventListener("drop", function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files[0]) onFile(files[0]);
    });
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function storedTheme() {
    try {
      return self.localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      self.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Storage can be unavailable; the preference simply is not kept. */
    }
  }

  function init() {
    applyTheme(storedTheme());
    el("theme").addEventListener("click", function () {
      var root = document.documentElement;
      var dark = root.getAttribute("data-theme") === "dark" ||
        (!root.hasAttribute("data-theme") &&
          self.matchMedia && self.matchMedia("(prefers-color-scheme: dark)").matches);
      var next = dark ? "light" : "dark";
      applyTheme(next);
      storeTheme(next);
    });

    var input = el("file");
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) loadFile(input.files[0]);
    });

    var drop = el("drop");
    ["dragenter", "dragover"].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.setAttribute("data-active", "true");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      drop.addEventListener(name, function (event) {
        event.preventDefault();
        drop.removeAttribute("data-active");
      });
    });
    drop.addEventListener("drop", function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (files && files[0]) loadFile(files[0]);
    });

    attachFilePicker(el("baseline-drop"), el("baseline-file"), function (file) {
      loadSide("baseline", file);
    });
    attachFilePicker(el("current-drop"), el("current-file"), function (file) {
      loadSide("current", file);
    });
  }

  init();
})();
