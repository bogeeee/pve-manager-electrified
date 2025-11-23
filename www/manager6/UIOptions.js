Ext.define('PVE.UIOptions', {
    singleton: true,

    options: {
        'allowed-tags': [],
    },

    update: function () {
        Proxmox.Utils.API2Request({
            url: '/cluster/options',
            method: 'GET',
            success: function (response) {
                for (const option of ['allowed-tags', 'console', 'tag-style']) {
                    PVE.UIOptions.options[option] = response?.result?.data?.[option];
                }

                PVE.UIOptions.updateTagList(PVE.UIOptions.options['allowed-tags']);
                PVE.UIOptions.updateTagSettings(PVE.UIOptions.options['tag-style']);
                PVE.UIOptions.fireUIConfigChanged();
            },
        });
    },

    tagList: [],

    updateTagList: function (tags) {
        PVE.UIOptions.tagList = [...new Set([...tags])].sort();
    },

    parseTagOverrides: function (overrides) {
        let colors = {};
        (overrides || '').split(';').forEach((color) => {
            if (!color) {
                return;
            }
            let [tag, color_hex, font_hex] = color.split(':');
            let r = parseInt(color_hex.slice(0, 2), 16);
            let g = parseInt(color_hex.slice(2, 4), 16);
            let b = parseInt(color_hex.slice(4, 6), 16);
            colors[tag] = [r, g, b];
            if (font_hex) {
                colors[tag].push(parseInt(font_hex.slice(0, 2), 16));
                colors[tag].push(parseInt(font_hex.slice(2, 4), 16));
                colors[tag].push(parseInt(font_hex.slice(4, 6), 16));
            }
        });
        return colors;
    },

    tagOverrides: {},

    updateTagOverrides: function (colors) {
        let sp = Ext.state.Manager.getProvider();
        let color_state = sp.get('colors', '');
        let browser_colors = PVE.UIOptions.parseTagOverrides(color_state);
        PVE.UIOptions.tagOverrides = Ext.apply({}, browser_colors, colors);
    },

    updateTagSettings: function (style) {
        let overrides = style?.['color-map'];
        PVE.UIOptions.updateTagOverrides(PVE.UIOptions.parseTagOverrides(overrides ?? ''));

        let shape = style?.shape ?? 'circle';
        if (shape === '__default__') {
            style = 'circle';
        }

        Ext.ComponentQuery.query('pveResourceTree')[0].setUserCls(`proxmox-tags-${shape}`);
    },

    tagTreeStyles: {
        __default__: `${Proxmox.Utils.defaultText} (${gettext('Circle')})`,
        full: gettext('Full'),
        circle: gettext('Circle'),
        dense: gettext('Dense'),
        none: Proxmox.Utils.NoneText,
    },

    tagOrderOptions: {
        __default__: `${Proxmox.Utils.defaultText} (${gettext('Alphabetical')})`,
        config: gettext('Configuration'),
        alphabetical: gettext('Alphabetical'),
    },

    shouldSortTags: function () {
        return !(PVE.UIOptions.options['tag-style']?.ordering === 'config');
    },

    getTreeSortingValue: function (key) {
        let localStorage = Ext.state.Manager.getProvider();
        let browserValues = localStorage.get('pve-tree-sorting');
        let defaults = {
            'sort-field': 'vmid',
            'group-templates': true,
            'group-guest-types': true,
        };

        return browserValues?.[key] ?? defaults[key];
    },

    fireUIConfigChanged: function () {
        PVE.data.ResourceStore.refresh();
        Ext.GlobalEvents.fireEvent('loadedUiOptions');
    },
});
