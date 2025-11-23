Ext.define('PVE.form.MDevSelector', {
    extend: 'Proxmox.form.ComboGrid',
    xtype: 'pveMDevSelector',

    store: {
        fields: ['type', 'available', 'description'],
        filterOnLoad: true,
        sorters: [
            {
                property: 'type',
                direction: 'ASC',
            },
        ],
    },
    autoSelect: false,
    valueField: 'type',
    displayField: 'type',
    listConfig: {
        width: 550,
        columns: [
            {
                header: gettext('Type'),
                dataIndex: 'type',
                renderer: function (value, md, rec) {
                    if (rec.data.name !== undefined) {
                        return `${rec.data.name} (${value})`;
                    }
                    return value;
                },
                flex: 1,
            },
            {
                header: gettext('Avail'),
                dataIndex: 'available',
                width: 60,
            },
            {
                header: gettext('Description'),
                dataIndex: 'description',
                flex: 1,
                cellWrap: true,
                renderer: function (value) {
                    if (!value) {
                        return '';
                    }

                    return value.split('\n').join('<br>');
                },
            },
        ],
    },

    setPciIdOrMapping: function (pciIdOrMapping, force) {
        var me = this;

        if (!force && (!pciIdOrMapping || me.pciIdOrMapping === pciIdOrMapping)) {
            return;
        }

        me.pciIdOrMapping = pciIdOrMapping;
        me.updateProxy();
    },

    setNodename: function (nodename) {
        var me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }

        me.nodename = nodename;
        me.updateProxy();
    },

    updateProxy: function () {
        var me = this;
        me.store.setProxy({
            type: 'proxmox',
            url: `/api2/json/nodes/${me.nodename}/hardware/pci/${me.pciIdOrMapping}/mdev`,
        });
        me.store.load();
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.callParent();

        if (me.pciIdOrMapping) {
            me.setPciIdOrMapping(me.pciIdOrMapping, true);
        }
    },
});
