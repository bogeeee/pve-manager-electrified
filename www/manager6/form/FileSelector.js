Ext.define('PVE.form.FileSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveFileSelector',

    editable: true,
    anyMatch: true,
    forceSelection: true,

    // Hide entries whose volume-name architecture differs from this node's; a checkbox below the
    // picker list reveals them. Only makes sense for container templates (vztmpl).
    archFilter: false,

    // Parse the dpkg architecture from a template volume name: the '_arm64' in
    // 'debian-13-standard_13.0-1_arm64.tar.zst'. Only a known arch is returned, so a custom name
    // is not mistaken for a foreign arch and hidden.
    templateArch: function (volid) {
        var arch = volid?.match(/_([a-z][a-z0-9]*)\.tar(?:\.\w+)?$/)?.[1];
        var known = ['amd64', 'arm64', 'i386', 'riscv64'];
        return known.includes(arch) ? arch : undefined;
    },

    listeners: {
        afterrender: function () {
            var me = this;
            if (!me.disabled) {
                me.setStorage(me.storage, me.nodename);
            }
        },
    },

    setStorage: function (storage, nodename) {
        var me = this;

        var change = false;
        if (storage && me.storage !== storage) {
            me.storage = storage;
            change = true;
        }

        if (nodename && me.nodename !== nodename) {
            me.nodename = nodename;
            change = true;
        }

        if (!(me.storage && me.nodename && change)) {
            return;
        }

        var url = '/api2/json/nodes/' + me.nodename + '/storage/' + me.storage + '/content';
        if (me.storageContent) {
            url += '?content=' + me.storageContent;
        }

        me.store.setProxy({
            type: 'proxmox',
            url: url,
        });

        me.applyFilters();

        me.store.removeAll();
        me.store.load();
    },

    applyFilters: function () {
        var me = this;

        var filters = [];
        if (Ext.isFunction(me.filter)) {
            filters.push(me.filter);
        }
        if (me.archStoreFilter && !me.showForeignArch && Proxmox.NodeArch) {
            filters.push(me.archStoreFilter);
        }

        me.store.clearFilter();
        if (filters.length) {
            me.store.addFilter(filters);
        }
    },

    setNodename: function (nodename) {
        this.setStorage(undefined, nodename);
    },

    store: {
        model: 'pve-storage-content',
    },

    allowBlank: false,
    autoSelect: false,
    valueField: 'volid',
    displayField: 'text',

    // An optional filter function
    filter: undefined,

    listConfig: {
        width: 600,
        columns: [
            {
                header: gettext('Name'),
                dataIndex: 'text',
                hideable: false,
                flex: 1,
            },
            {
                header: gettext('Format'),
                width: 60,
                dataIndex: 'format',
            },
            {
                header: gettext('Size'),
                width: 100,
                dataIndex: 'size',
                renderer: Proxmox.Utils.format_size,
            },
        ],
    },

    initComponent: function () {
        var me = this;

        if (me.archFilter) {
            me.archStoreFilter = new Ext.util.Filter({
                id: 'pve-file-selector-arch',
                filterFn: function (rec) {
                    var arch = me.templateArch(rec.data.volid);
                    return !arch || arch === Proxmox.NodeArch;
                },
            });

            // Toggle sits below the list so the field stays full-width. The emptyText is not just
            // cosmetic: it lets the combo expand when the filter hides every entry, so the toggle
            // stays reachable and a mandatory field can still be satisfied.
            me.listConfig = Ext.apply({}, me.listConfig);
            me.listConfig.emptyText = gettext(
                'No templates for this architecture. Use "Show all architectures" below.',
            );
            me.listConfig.bbar = [
                {
                    xtype: 'proxmoxcheckbox',
                    boxLabel: gettext('Show all architectures'),
                    value: false,
                    listeners: {
                        change: function (checkbox, value) {
                            me.showForeignArch = value;
                            if (!me.archStoreFilter || !Proxmox.NodeArch) {
                                return;
                            }
                            if (value) {
                                me.store.removeFilter(me.archStoreFilter);
                            } else {
                                me.store.addFilter(me.archStoreFilter);
                            }
                        },
                    },
                },
            ];
        }

        me.callParent();
    },
});
