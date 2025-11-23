Ext.define('PVE.form.ComboBoxSetStoreNode', {
    extend: 'Proxmox.form.ComboGrid',
    config: {
        apiBaseUrl: '/api2/json/nodes/',
        apiSuffix: '',
    },

    showNodeSelector: false,

    setNodeName: function (value) {
        let me = this;
        value ||= Proxmox.NodeName;

        me.getStore().getProxy().setUrl(`${me.apiBaseUrl}${value}${me.apiSuffix}`);
        me.clearValue();
    },

    nodeChange: function (_field, value) {
        let me = this;
        // disable autoSelect if there is already a selection or we have the picker open
        if (me.getValue() || me.isExpanded) {
            let autoSelect = me.autoSelect;
            me.autoSelect = false;
            me.store.on(
                'afterload',
                function () {
                    me.autoSelect = autoSelect;
                },
                { single: true },
            );
        }
        me.setNodeName(value);
        me.fireEvent('nodechanged', value);
    },

    tbarMouseDown: function () {
        this.topBarMousePress = true;
    },

    tbarMouseUp: function () {
        let me = this;
        delete this.topBarMousePress;
        if (me.focusLeft) {
            me.focus();
            delete me.focusLeft;
        }
    },

    // conditionally prevent the focusLeave handler to continue, preventing collapsing of the picker
    onFocusLeave: function () {
        let me = this;
        me.focusLeft = true;
        if (!me.topBarMousePress) {
            me.callParent(arguments);
        }

        return undefined;
    },

    initComponent: function () {
        let me = this;

        if (me.showNodeSelector && !PVE.Utils.isStandaloneNode()) {
            me.errorHeight = 140;
            Ext.apply(me.listConfig ?? {}, {
                tbar: {
                    xtype: 'toolbar',
                    minHeight: 40,
                    listeners: {
                        mousedown: me.tbarMouseDown,
                        mouseup: me.tbarMouseUp,
                        element: 'el',
                        scope: me,
                    },
                    items: [
                        {
                            xtype: 'pveStorageScanNodeSelector',
                            autoSelect: false,
                            fieldLabel: gettext('Node to scan'),
                            listeners: {
                                change: (field, value) => me.nodeChange(field, value),
                            },
                        },
                    ],
                },
                emptyText: me.listConfig?.emptyText ?? gettext('Nothing found'),
            });
        }

        me.callParent();
    },
});
