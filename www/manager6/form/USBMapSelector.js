Ext.define('PVE.form.USBMapSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveUSBMapSelector',

    store: {
        fields: ['name', 'vendor', 'device', 'path'],
        filterOnLoad: true,
        sorters: [
            {
                property: 'name',
                direction: 'ASC',
            },
        ],
    },

    allowBlank: false,
    autoSelect: false,
    displayField: 'id',
    valueField: 'id',

    listConfig: {
        width: 800,
        columns: [
            {
                header: gettext('Name'),
                dataIndex: 'id',
                flex: 1,
            },
            {
                header: gettext('Status'),
                dataIndex: 'errors',
                flex: 2,
                renderer: function (value) {
                    let _me = this;

                    if (!Ext.isArray(value) || !value?.length) {
                        return `<i class="fa fa-check-circle good"></i> ${gettext('Mapping matches host data')}`;
                    }

                    let errors = [];

                    value.forEach((error) => {
                        let iconCls;
                        switch (error?.severity) {
                            case 'warning':
                                iconCls = 'fa-exclamation-circle warning';
                                break;
                            case 'error':
                                iconCls = 'fa-times-circle critical';
                                break;
                        }

                        let message = error?.message;
                        let icon = `<i class="fa ${iconCls}"></i>`;
                        if (iconCls !== undefined) {
                            errors.push(`${icon} ${message}`);
                        }
                    });

                    return errors.join('<br>');
                },
            },
            {
                header: gettext('Comment'),
                dataIndex: 'description',
                flex: 1,
                renderer: Ext.String.htmlEncode,
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
            url: `/api2/json/cluster/mapping/usb?check-node=${nodename}`,
        });

        me.store.load();
    },

    initComponent: function () {
        var me = this;

        var nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        me.setNodename(nodename);
    },
});
