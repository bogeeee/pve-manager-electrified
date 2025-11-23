Ext.define('PVE.form.IPRefSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.pveIPRefSelector'],

    base_url: undefined,

    preferredValue: '', // hack: else Form sets dirty flag?

    ref_type: undefined, // undefined = any [undefined, 'ipset' or 'alias']

    valueField: 'scopedref',
    displayField: 'ref',
    notFoundIsValid: true,

    initComponent: function () {
        var me = this;

        if (!me.base_url) {
            throw 'no base_url specified';
        }

        var url = '/api2/json' + me.base_url;
        if (me.ref_type) {
            url += '?type=' + me.ref_type;
        }

        var store = Ext.create('Ext.data.Store', {
            autoLoad: true,
            fields: [
                'type',
                'name',
                'ref',
                'comment',
                'scope',
                {
                    name: 'scopedref',
                    calculate: function (v) {
                        if (v.type === 'alias') {
                            return `${v.scope}/${v.name}`;
                        } else if (v.type === 'ipset') {
                            return `+${v.scope}/${v.name}`;
                        } else {
                            return v.ref;
                        }
                    },
                },
            ],
            idProperty: 'ref',
            proxy: {
                type: 'proxmox',
                url: url,
            },
            sorters: {
                property: 'ref',
                direction: 'ASC',
            },
        });

        var columns = [];

        if (!me.ref_type) {
            columns.push({
                header: gettext('Type'),
                dataIndex: 'type',
                hideable: false,
                width: 60,
            });
        }

        let scopes = {
            dc: gettext('Datacenter'),
            guest: gettext('Guest'),
            sdn: gettext('SDN'),
        };

        columns.push(
            {
                header: gettext('Name'),
                dataIndex: 'ref',
                hideable: false,
                width: 140,
            },
            {
                header: gettext('Scope'),
                dataIndex: 'scope',
                hideable: false,
                width: 140,
                renderer: function (value) {
                    return scopes[value] ?? 'unknown scope';
                },
            },
            {
                header: gettext('Comment'),
                dataIndex: 'comment',
                renderer: Ext.String.htmlEncode,
                minWidth: 60,
                flex: 1,
            },
        );

        Ext.apply(me, {
            store: store,
            listConfig: {
                columns: columns,
                width: 500,
            },
        });

        me.on('beforequery', function (queryPlan) {
            return !(queryPlan.query === null || queryPlan.query.match(/^\d/));
        });

        me.callParent();
    },
});
