// ======================================================
// LOG
// ======================================================
function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ["🟦 [PLUGIN]"].concat(args));
}

// ======================================================
// Load all fonts for a text node
// ======================================================
function loadAllFonts(node) {
  return new Promise(function (resolve) {
    try {
      var fonts = node.getRangeAllFontNames(0, node.characters.length);
      var i = 0;
      (function next() {
        if (i >= fonts.length) return resolve();
        figma.loadFontAsync(fonts[i]).then(function () {
          i++;
          next();
        });
      })();
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
// Set text by name
// ======================================================
function setTextIfExists(parent, name, value) {
  return new Promise(function (resolve) {
    var node = parent.findOne(function (n) {
      return n.name === name && n.type === "TEXT";
    });

    if (!node) return resolve();

    loadAllFonts(node).then(function () {
      try {
        node.characters = value;
      } catch (err) {}
      resolve();
    });
  });
}

// ======================================================
// Apply QR image
// ======================================================
function setQrImage(frame, url, nodeName) {
  return new Promise(function (resolve) {
    var qrNode = frame.findOne(function (n) {
      return n.name === nodeName && n.fills !== undefined;
    });

    if (!qrNode) return resolve();

    fetch(url)
      .then(function (response) {
        if (!response.ok) return resolve();
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var img = figma.createImage(bytes);

        qrNode.fills = [{
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: img.hash
        }];

        resolve();
      })
      .catch(function () {
        resolve();
      });
  });
}

// ======================================================
// Clean external_ref → extract number after "#"
// ======================================================
function sanitizeExternalRef(ref) {
  if (!ref) return "Panel";
  var i = ref.indexOf("#");
  if (i === -1) return "Panel";
  var num = ref.substring(i + 1).trim();
  return num === "" ? "Panel" : num;
}

// ======================================================
// UI
// ======================================================
figma.showUI(__html__, { width: 340, height: 340 });

// ======================================================
// MAIN
// ======================================================
figma.ui.onmessage = function (msg) {
  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }

  if (msg.type !== "generate") return;

  var webhook = msg.webhook;
  var targetPageName = msg.targetPage;

  if (!webhook) {
    figma.notify("❌ Webhook URL required");
    return;
  }

  if (!targetPageName) {
    figma.notify("❌ Target Page Name required");
    return;
  }

  fetch(webhook)
    .then(function (res) { return res.json(); })
    .then(function (touchpoints) {

      if (!Array.isArray(touchpoints)) {
        figma.notify("❌ Invalid webhook response");
        return;
      }

      // Find or create target page
      var targetPage = figma.root.findOne(function (n) {
        return n.type === "PAGE" && n.name === targetPageName;
      });

      if (!targetPage) {
        targetPage = figma.createPage();
        targetPage.name = targetPageName;
      }

      var xRecto = 50;
      var xVersoOffset = 150;   // horizontal spacing
      var yOffset = 50;
      var lineSpacing = 400;   // vertical spacing

      touchpoints.forEach(function (tp) {

        var id = tp.public_id;
        var qr = tp.qr_image_url + "?type=png";
        var org = tp.org_name || "";
        var gender = (tp.avatar_genre === "male") ? "Male" : "Female";
        var refClean = sanitizeExternalRef(tp.external_ref);

        var name = refClean + " — " + org + " — " + id;

        // Global search for templates
        var rectoTemplate = figma.root.findOne(function (n) {
          return n.name === (gender === "Male" ? "Template_Male" : "Template_Female") && n.type === "FRAME";
        });

        var versoTemplate = figma.root.findOne(function (n) {
          return n.name === (gender === "Male" ? "Template_Male_Back" : "Template_Female_Back") && n.type === "FRAME";
        });

        if (!rectoTemplate || !versoTemplate) return;

        // Clone RECTO
        var recto = rectoTemplate.clone();
        targetPage.appendChild(recto);
        recto.name = name;
        recto.x = xRecto;
        recto.y = yOffset;

        // Apply ID + QR recto
        setTextIfExists(recto, "ID_TEXT", id)
          .then(function () { return setQrImage(recto, qr, "QR_IMAGE"); })
          .then(function () {

            // Get recto width after render
            var bounds = recto.absoluteRenderBounds;
            var rectoWidth = bounds ? bounds.width : recto.width;

            // Clone VERSO
            var verso = versoTemplate.clone();
            targetPage.appendChild(verso);
            verso.name = name + " — Back";

            verso.x = recto.x + rectoWidth + xVersoOffset;
            verso.y = recto.y;

            return setTextIfExists(verso, "ID_TEXT_V", id)
              .then(function () { return setQrImage(verso, qr, "QR_IMAGE_V"); });
          });

        // Next line
        yOffset += lineSpacing;

      });

      figma.notify("🎉 Panels generated successfully!");
    })
    .catch(function () {
      figma.notify("❌ Webhook fetch failed");
    });
};
