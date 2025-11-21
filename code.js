// ======================================================
// LOG / DEBUG
// ======================================================
function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ["🟦 [PLUGIN]"].concat(args));
}

// ======================================================
// Charger toutes les polices d’un node texte
// ======================================================
function loadAllFonts(node) {
  return new Promise(function (resolve) {
    try {
      var fonts = node.getRangeAllFontNames(0, node.characters.length);
      var i = 0;

      function loadNext() {
        if (i >= fonts.length) return resolve();
        figma.loadFontAsync(fonts[i]).then(function () {
          i++;
          loadNext();
        });
      }
      loadNext();

    } catch (err) {
      if (node.fontName && node.fontName !== figma.mixed) {
        figma.loadFontAsync(node.fontName).then(resolve);
      } else {
        resolve();
      }
    }
  });
}

// ======================================================
// Modifier un node texte si présent
// ======================================================
function setTextIfExists(parent, name, value) {
  return new Promise(function (resolve) {
    if (!value) return resolve();

    var node = parent.findOne(function (n) {
      return n.name === name && n.type === "TEXT";
    });

    if (!node) {
      log("❌ Text node introuvable:", name);
      return resolve();
    }

    loadAllFonts(node).then(function () {
      try {
        node.characters = value;
      } catch (err) {
        log("❌ Erreur setTextIfExists:", err);
      }
      resolve();
    });
  });
}

// ======================================================
// Extraire ID depuis l'URL QR
// ======================================================
function extractIdFromQrUrl(url) {
  if (!url) return "";

  try {
    var u = new URL(url);
    var parts = u.pathname.split("/").filter(function (p) { return p; });
    var qrIndex = parts.indexOf("qr");

    if (qrIndex >= 0 && qrIndex + 1 < parts.length) {
      return parts[qrIndex + 1];
    }

  } catch (err) {}

  var m = url.match(/\/qr\/([^\/\?]+)/);
  if (m && m[1]) return m[1];

  return "";
}

// ======================================================
// Appliquer une image (QR)
// ======================================================
function setQrImage(frame, url, nodeName) {
  return new Promise(function (resolve) {
    var qrNode = frame.findOne(function (n) {
      return n.name === nodeName && n.fills !== undefined;
    });

    if (!qrNode) {
      figma.notify("❌ Node '" + nodeName + "' introuvable");
      return resolve();
    }

    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          figma.notify("❌ Erreur HTTP : " + response.status);
          return resolve();
        }
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var image = figma.createImage(bytes);

        qrNode.fills = [{
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: image.hash
        }];

        resolve();
      })
      .catch(function (err) {
        log("❌ Erreur QR download:", err);
        figma.notify("❌ Impossible de charger le QR");
        resolve();
      });
  });
}

// ======================================================
// UI
// ======================================================
figma.showUI(__html__, { width: 340, height: 380 });

// ======================================================
// MESSAGE UI
// ======================================================
figma.ui.onmessage = function (msg) {

  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }

  if (msg.type !== "create-panel") return;

  var qrUrlRaw     = msg.qrUrl ? msg.qrUrl.trim() : "";
  var reference    = msg.reference ? msg.reference.trim() : "";
  var organization = msg.organization ? msg.organization.trim() : "";
  var gender       = msg.gender ? msg.gender : "Female";
  var targetPageName = msg.targetPage ? msg.targetPage.trim() : "";

  if (!qrUrlRaw) {
    figma.notify("❌ L'URL du QR est obligatoire");
    return;
  }

  if (!targetPageName) {
    figma.notify("❌ Le nom de la page cible est obligatoire");
    return;
  }

  var id = extractIdFromQrUrl(qrUrlRaw);
  if (!id) {
    figma.notify("❌ Impossible d'extraire l'ID depuis l'URL du QR");
    return;
  }

  var qrUrl =
    qrUrlRaw.indexOf("?") === -1 ? qrUrlRaw + "?type=png" : qrUrlRaw + "&type=png";

  var rectoName = gender === "Male" ? "Template_Male" : "Template_Female";
  var versoName = gender === "Male" ? "Template_Male_Back" : "Template_Female_Back";

  var rectoTemplate = figma.currentPage.findOne(function (n) {
    return n.name === rectoName && n.type === "FRAME";
  });

  var versoTemplate = figma.currentPage.findOne(function (n) {
    return n.name === versoName && n.type === "FRAME";
  });

  if (!rectoTemplate) {
    figma.notify("❌ Template recto introuvable : " + rectoName);
    return;
  }
  if (!versoTemplate) {
    figma.notify("❌ Template verso introuvable : " + versoName);
    return;
  }

  // ================================
  // PAGE CIBLE (trouver ou créer)
  // ================================
  var targetPage = figma.root.findOne(function (n) {
    return n.type === "PAGE" && n.name === targetPageName;
  });

  if (!targetPage) {
    targetPage = figma.createPage();
    targetPage.name = targetPageName;
  }

  // ================================
  // AUTO-PLACEMENT VERTICAL
  // ================================
  var existingPanels = targetPage.children.filter(function (n) {
    return n.type === "FRAME";
  });

  var nextY = 50;

  if (existingPanels.length > 0) {
    var maxY = 0;

    for (var i = 0; i < existingPanels.length; i++) {
      var node = existingPanels[i];
      var bounds = node.absoluteRenderBounds;
      var bottom = bounds ? (bounds.y + bounds.height) : (node.y + node.height);

      if (bottom > maxY) maxY = bottom;
    }

    nextY = maxY + 150;
  }

  // ================================
  // CLONAGE RECTO
  // ================================
  var recto = rectoTemplate.clone();
  targetPage.appendChild(recto);

  recto.x = 50;
  recto.y = nextY;

  var refPart = reference || "Avatar";
  var orgPart = organization || "";

  recto.name =
    orgPart ? refPart + " — " + orgPart + " — " + id : refPart + " — " + id;

  setTextIfExists(recto, "ID_TEXT", id)
    .then(function () {
      return setQrImage(recto, qrUrl, "QR_IMAGE");
    })
    .then(function () {

      // Force recalcul de layout du recto
      var bounds = recto.absoluteRenderBounds;
      var rectoWidth = bounds ? bounds.width : recto.width;

      // ================================
      // CLONAGE VERSO
      // ================================
      var verso = versoTemplate.clone();
      targetPage.appendChild(verso);

      verso.x = recto.x + rectoWidth + 80;
      verso.y = recto.y;

      verso.name = recto.name + " — Back";

      return setTextIfExists(verso, "ID_TEXT_V", id)
        .then(function () {
          return setQrImage(verso, qrUrl, "QR_IMAGE_V");
        });
    })
    .then(function () {
      figma.notify("🎉 Recto + Verso générés !");
    });
};
