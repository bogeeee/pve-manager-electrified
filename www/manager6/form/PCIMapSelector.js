Ext.define('pve-mapped-pci-model', {
    extend: 'Ext.data.Model',

    fields: ['id', 'path', 'vendor', 'device', 'iommugroup', 'mdev', 'description', 'map'],
    idProperty: 'id',
});

Ext.define('PVE.form.PCIMapSelector', {
    extend: 'Proxmox.form.ComboGrid',
    xtype: 'pvePCIMapSelector',

    store: {
        model: 'pve-mapped-pci-model',
        filterOnLoad: true,
        sorters: [
            {
                property: 'id',
                direction: 'ASC',
            },
        ],
    },

    autoSelect: false,
    valueField: 'id',
    displayField: 'id',

    // can contain a load callback for the store
    // useful to determine the state of the IOMMU
    onLoadCallBack: undefined,

    listConfig: {
        width: 800,
        columns: [
            {
                header: gettext('ID'),
                dataIndex: 'id',
                flex: 1,
            },
            {
                header: gettext('Description'),
                dataIndex: 'description',
                flex: 1,
                renderer: Ext.String.htmlEncode,
            },
            {
                header: gettext('Status'),
                dataIndex: 'checks',
                renderer: function (value) {
                    let _me = this;

                    if (!Ext.isArray(value) || !value?.length) {
                        return `<i class="fa fa-check-circle good"></i> ${gettext('Mapping matches host data')}`;
                    }

                    let checks = [];

                    value.forEach((check) => {
                        let iconCls;
                        switch (check?.severity) {
                            case 'warning':
                                iconCls = 'fa-exclamation-circle warning';
                                break;
                            case 'error':
                                iconCls = 'fa-times-circle critical';
                                break;
                        }

                        let message = check?.message;
                        let icon = `<i class="fa ${iconCls}"></i>`;
                        if (iconCls !== undefined) {
                            checks.push(`${icon} ${message}`);
                        }
                    });

                    return checks.join('<br>');
                },
                flex: 3,
            },
        ],
    },

    setNodename: function (nodename) {
        var me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }

        me.nodename = nodename;

        me.store.setProxy({
            type: 'proxmox',
            url: `/api2/json/cluster/mapping/pci?check-node=${nodename}`,
        });

        me.store.load();
    },

    initComponent: function () {
        var me = this;

        var nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        if (me.onLoadCallBack !== undefined) {
            me.mon(me.getStore(), 'load', me.onLoadCallBack);
        }

        me.setNodename(nodename);
    },
});
